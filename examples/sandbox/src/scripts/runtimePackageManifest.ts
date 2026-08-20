import { readFile } from 'fs/promises';
import path from 'path';

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  dependencies?: unknown;
  peerDependencies?: unknown;
};

const readJson = async (filePath: string): Promise<PackageManifest> =>
  JSON.parse(await readFile(filePath, 'utf8')) as PackageManifest;

const runtimeDependencyNames = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
        .filter((name) => name.startsWith('@tradejs/'))
        .sort((left, right) => left.localeCompare(right))
    : [];

const requirePackageIdentity = (
  manifest: PackageManifest,
  expectedName?: string,
) => {
  if (
    typeof manifest.name !== 'string' ||
    !manifest.name.trim() ||
    typeof manifest.version !== 'string' ||
    !manifest.version.trim() ||
    (expectedName !== undefined && manifest.name !== expectedName)
  ) {
    throw new Error(
      `Invalid sandbox package identity${expectedName ? `: ${expectedName}` : ''}`,
    );
  }
  return { name: manifest.name, version: manifest.version };
};

export const collectSandboxRuntimePackageVersions = async (
  projectRoot: string,
) => {
  const projectManifest = await readJson(
    path.join(projectRoot, 'package.json'),
  );
  const projectIdentity = requirePackageIdentity(projectManifest);
  const packages: Record<string, string> = {
    [projectIdentity.name]: projectIdentity.version,
  };
  const queue = runtimeDependencyNames(projectManifest.dependencies);

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || Object.hasOwn(packages, packageName)) continue;
    const manifest = await readJson(
      path.join(
        projectRoot,
        'node_modules',
        ...packageName.split('/'),
        'package.json',
      ),
    );
    const identity = requirePackageIdentity(manifest, packageName);
    packages[identity.name] = identity.version;
    queue.push(
      ...runtimeDependencyNames(manifest.dependencies),
      ...runtimeDependencyNames(manifest.peerDependencies),
    );
  }

  return Object.fromEntries(
    Object.entries(packages).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
};
