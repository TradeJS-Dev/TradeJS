import { builtinModules } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import ts from 'typescript';

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs']);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const allowedWorkspaceDependencies = new Map([
  ['@tradejs/types', new Set()],
  ['@tradejs/core', new Set(['@tradejs/types'])],
  ['@tradejs/infra', new Set(['@tradejs/types'])],
  ['@tradejs/indicators', new Set(['@tradejs/core', '@tradejs/types'])],
  [
    '@tradejs/strategies',
    new Set(['@tradejs/core', '@tradejs/indicators', '@tradejs/types']),
  ],
  [
    '@tradejs/node',
    new Set(['@tradejs/core', '@tradejs/infra', '@tradejs/types']),
  ],
  [
    '@tradejs/connectors',
    new Set([
      '@tradejs/core',
      '@tradejs/infra',
      '@tradejs/node',
      '@tradejs/types',
    ]),
  ],
  [
    '@tradejs/base',
    new Set([
      '@tradejs/connectors',
      '@tradejs/core',
      '@tradejs/indicators',
      '@tradejs/node',
      '@tradejs/strategies',
    ]),
  ],
]);

const errors = [];

const listDirectories = async (directory) =>
  (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name));

const listSourceFiles = async (directory) => {
  if (!existsSync(directory)) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(entryPath);
      return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
    }),
  );

  return files.flat();
};

const packageNameFromSpecifier = (specifier) => {
  if (specifier.startsWith('.') || specifier.startsWith('#')) return null;
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
};

const extractSpecifiers = (source, file) => {
  const specifiers = [];
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const addModuleSpecifier = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.push(node.text);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addModuleSpecifier(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addModuleSpecifier(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) addModuleSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return [...new Set(specifiers)];
};

const isTestFile = (file) =>
  file.includes(`${path.sep}__tests__${path.sep}`) ||
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);

const packageDirectories = [
  ...(await listDirectories(path.join(root, 'packages'))),
  ...(await listDirectories(path.join(root, 'apps'))),
].filter((directory) => existsSync(path.join(directory, 'package.json')));

const packages = await Promise.all(
  packageDirectories.map(async (directory) => ({
    directory,
    manifest: JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')),
    files: await listSourceFiles(path.join(directory, 'src')),
  })),
);
const workspaceNames = new Set(packages.map(({ manifest }) => manifest.name));

for (const packageInfo of packages) {
  const { directory, files, manifest } = packageInfo;
  const declaredDependencies = new Set(
    Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    }),
  );
  const allowedWorkspace = allowedWorkspaceDependencies.get(manifest.name);

  for (const file of files) {
    const relativeFile = path.relative(root, file);
    const source = await readFile(file, 'utf8');

    for (const specifier of extractSpecifiers(source, file)) {
      if (/^@tradejs\/(?:core|node|infra)$/.test(specifier)) {
        errors.push(`${relativeFile}: root package import is forbidden: ${specifier}`);
      }
      if (/^@tradejs\/(?:core|node|infra)\/src(?:\/|$)/.test(specifier)) {
        errors.push(`${relativeFile}: non-public deep import is forbidden: ${specifier}`);
      }
      if (
        specifier === '@tradejs/infra/timescale' &&
        manifest.name !== '@tradejs/infra' &&
        !isTestFile(file)
      ) {
        errors.push(
          `${relativeFile}: use a focused @tradejs/infra/timescale/* subpath`,
        );
      }

      const dependency = packageNameFromSpecifier(specifier);
      if (!dependency || builtins.has(specifier) || builtins.has(dependency)) continue;
      if (dependency === manifest.name) continue;

      if (!declaredDependencies.has(dependency)) {
        errors.push(
          `${relativeFile}: ${dependency} is imported but not declared by ${manifest.name}`,
        );
      }

      if (
        workspaceNames.has(dependency) &&
        allowedWorkspace &&
        !isTestFile(file) &&
        !allowedWorkspace.has(dependency)
      ) {
        errors.push(
          `${relativeFile}: forbidden package direction ${manifest.name} -> ${dependency}`,
        );
      }
    }
  }

  if (manifest.name === '@tradejs/types' && manifest.dependencies) {
    const runtimeDependencies = Object.keys(manifest.dependencies);
    if (runtimeDependencies.length > 0) {
      errors.push(
        `${path.relative(root, directory)}/package.json: @tradejs/types must not have runtime dependencies`,
      );
    }
  }
}

const coreEntries = (await readdir(path.join(root, 'packages/core/src')))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => path.join(root, 'packages/core/src', file));

try {
  await build({
    entryPoints: coreEntries,
    bundle: true,
    format: 'esm',
    logLevel: 'silent',
    outdir: path.join(root, '.architecture-check'),
    platform: 'browser',
    splitting: true,
    tsconfig: path.join(root, 'packages/core/tsconfig.build.json'),
    write: false,
  });
} catch (error) {
  const details = Array.isArray(error?.errors)
    ? error.errors.map((item) => item.text).join('; ')
    : String(error);
  errors.push(`@tradejs/core is not browser-bundleable: ${details}`);
}

if (errors.length > 0) {
  console.error('Architecture checks failed:\n');
  for (const error of [...new Set(errors)].sort()) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Architecture checks passed.');
}
