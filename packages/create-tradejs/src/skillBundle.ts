import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const PROJECT_SKILL_BUNDLE_MANIFEST = '.codex/tradejs-skill-bundle.json';

export const PROJECT_SKILL_NAMES = [
  'strategy-candidate-report',
  'strategy-candidate-compare',
  'strategy-improvement-plan',
  'strategy-improvement-research',
  'strategy-period-revalidate',
  'strategy-forward-start',
  'strategy-forward-status',
  'strategy-risk-scale',
] as const;

export interface TradejsSkillBundleManifest {
  schema: 'tradejs-skill-bundle/v1';
  source: 'TradeJS-Dev/TradeJS:.codex/skills';
  bundleSha256: string;
  skills: string[];
  files: Record<string, string>;
}

const sha256 = (contents: string | Buffer) =>
  createHash('sha256').update(contents).digest('hex');

const toProjectPath = (...parts: string[]) => path.posix.join(...parts);

const readDirectory = (
  directory: string,
  projectDirectory: string,
  files: Record<string, string>,
) => {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    const absolutePath = path.join(directory, entry.name);
    const projectPath = toProjectPath(projectDirectory, entry.name);
    if (entry.isDirectory()) {
      readDirectory(absolutePath, projectPath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(
        `Skill bundle source must contain regular files: ${absolutePath}`,
      );
    }
    files[projectPath] = readFileSync(absolutePath, 'utf8');
  }
};

const calculateBundleSha256 = (fileHashes: Record<string, string>) =>
  sha256(
    Object.entries(fileHashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, fileSha256]) => `${filePath}\0${fileSha256}`)
      .join('\n'),
  );

export const createProjectSkillBundle = (canonicalSkillsRoot: string) => {
  const files: Record<string, string> = {};

  for (const skillName of PROJECT_SKILL_NAMES) {
    const skillRoot = path.join(canonicalSkillsRoot, skillName);
    if (!existsSync(path.join(skillRoot, 'SKILL.md'))) {
      throw new Error(`Missing canonical skill: ${skillName}`);
    }
    readDirectory(
      skillRoot,
      toProjectPath('.codex', 'skills', skillName),
      files,
    );
  }

  const fileHashes = Object.fromEntries(
    Object.entries(files).map(([filePath, contents]) => [
      filePath,
      sha256(contents),
    ]),
  );
  const manifest: TradejsSkillBundleManifest = {
    schema: 'tradejs-skill-bundle/v1',
    source: 'TradeJS-Dev/TradeJS:.codex/skills',
    bundleSha256: calculateBundleSha256(fileHashes),
    skills: [...PROJECT_SKILL_NAMES],
    files: Object.fromEntries(
      Object.entries(fileHashes).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };

  return {
    manifest,
    files: {
      ...files,
      [PROJECT_SKILL_BUNDLE_MANIFEST]: `${JSON.stringify(manifest, null, 2)}\n`,
    },
  };
};

export const readPackagedSkillBundle = (bundleRoot: string) => {
  const files: Record<string, string> = {};
  readDirectory(bundleRoot, '', files);
  const manifestContents = files[PROJECT_SKILL_BUNDLE_MANIFEST];
  if (!manifestContents) {
    throw new Error(`Missing packaged ${PROJECT_SKILL_BUNDLE_MANIFEST}`);
  }
  const manifest = JSON.parse(manifestContents) as TradejsSkillBundleManifest;

  if (
    manifest.schema !== 'tradejs-skill-bundle/v1' ||
    manifest.source !== 'TradeJS-Dev/TradeJS:.codex/skills' ||
    JSON.stringify(manifest.skills) !== JSON.stringify(PROJECT_SKILL_NAMES) ||
    manifest.bundleSha256 !== calculateBundleSha256(manifest.files)
  ) {
    throw new Error('Invalid packaged TradeJS skill bundle manifest');
  }
  const packagedFilePaths = Object.keys(files)
    .filter((filePath) => filePath !== PROJECT_SKILL_BUNDLE_MANIFEST)
    .sort();
  if (
    JSON.stringify(packagedFilePaths) !==
    JSON.stringify(Object.keys(manifest.files).sort())
  ) {
    throw new Error('Packaged TradeJS skill bundle contains unbound files');
  }
  for (const [filePath, expectedSha256] of Object.entries(manifest.files)) {
    const contents = files[filePath];
    if (contents === undefined || sha256(contents) !== expectedSha256) {
      throw new Error(`Packaged TradeJS skill bundle mismatch: ${filePath}`);
    }
  }

  return { files, manifest };
};

export const writeProjectSkillBundle = (
  canonicalSkillsRoot: string,
  outputRoot: string,
) => {
  const { files, manifest } = createProjectSkillBundle(canonicalSkillsRoot);
  rmSync(outputRoot, { recursive: true, force: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const destination = path.join(outputRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents, 'utf8');
  }
  return manifest;
};

const isManagedSkillPath = (relativePath: string) => {
  const normalized = relativePath.replaceAll('\\', '/');
  return (
    normalized === PROJECT_SKILL_BUNDLE_MANIFEST ||
    (normalized.startsWith('.codex/skills/') &&
      !normalized.includes('../') &&
      !path.posix.isAbsolute(normalized))
  );
};

const readInstalledManifest = (projectRoot: string) => {
  const manifestPath = path.join(projectRoot, PROJECT_SKILL_BUNDLE_MANIFEST);
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as TradejsSkillBundleManifest;
  if (manifest.schema !== 'tradejs-skill-bundle/v1') {
    throw new Error(`Unsupported installed skill bundle: ${manifestPath}`);
  }
  return manifest;
};

export const syncProjectSkillBundle = (
  projectRoot: string,
  bundleFiles: Record<string, string>,
) => {
  if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
    throw new Error(`Project directory does not exist: ${projectRoot}`);
  }
  const newManifest = JSON.parse(
    bundleFiles[PROJECT_SKILL_BUNDLE_MANIFEST],
  ) as TradejsSkillBundleManifest;
  const installedManifest = readInstalledManifest(projectRoot);

  for (const [relativePath, contents] of Object.entries(bundleFiles)) {
    if (!isManagedSkillPath(relativePath)) {
      throw new Error(`Unsafe managed skill path: ${relativePath}`);
    }
    const destination = path.resolve(projectRoot, relativePath);
    if (!destination.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
      throw new Error(
        `Managed skill path escapes the project: ${relativePath}`,
      );
    }
    if (
      existsSync(destination) &&
      relativePath !== PROJECT_SKILL_BUNDLE_MANIFEST
    ) {
      const currentContents = readFileSync(destination, 'utf8');
      const installedSha256 = installedManifest?.files[relativePath];
      const isKnownInstalledFile =
        installedSha256 !== undefined &&
        sha256(currentContents) === installedSha256;
      if (!isKnownInstalledFile && currentContents !== contents) {
        throw new Error(
          `Refusing to overwrite a modified skill: ${relativePath}`,
        );
      }
    }
  }

  for (const [relativePath, installedSha256] of Object.entries(
    installedManifest?.files ?? {},
  )) {
    if (newManifest.files[relativePath] !== undefined) continue;
    if (!isManagedSkillPath(relativePath)) {
      throw new Error(`Unsafe installed skill path: ${relativePath}`);
    }
    const obsoletePath = path.resolve(projectRoot, relativePath);
    if (!existsSync(obsoletePath)) continue;
    const contents = readFileSync(obsoletePath);
    if (sha256(contents) !== installedSha256) {
      throw new Error(
        `Refusing to remove a modified obsolete skill: ${relativePath}`,
      );
    }
    rmSync(obsoletePath);
  }

  for (const [relativePath, contents] of Object.entries(bundleFiles)) {
    const destination = path.join(projectRoot, relativePath);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, contents, 'utf8');
  }

  return newManifest;
};
