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
  [
    '@tradejs/cli',
    new Set([
      '@tradejs/base',
      '@tradejs/connectors',
      '@tradejs/core',
      '@tradejs/indicators',
      '@tradejs/infra',
      '@tradejs/node',
      '@tradejs/strategies',
      '@tradejs/types',
    ]),
  ],
  [
    '@tradejs/app',
    new Set([
      '@tradejs/connectors',
      '@tradejs/core',
      '@tradejs/indicators',
      '@tradejs/infra',
      '@tradejs/node',
      '@tradejs/strategies',
      '@tradejs/types',
    ]),
  ],
  ['create-tradejs', new Set()],
  ['@tradejs/ml', new Set()],
]);

const allowedTestWorkspaceDependencies = new Map([
  ['@tradejs/node', new Set(['@tradejs/strategies'])],
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

const packageSubpathFromSpecifier = (specifier, packageName) => {
  if (specifier === packageName) return '.';
  return `.${specifier.slice(packageName.length)}`;
};

const isExportedSubpath = (manifest, subpath) => {
  const packageExports = manifest.exports;
  if (!packageExports || typeof packageExports !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(packageExports, subpath)) return true;

  return Object.keys(packageExports).some((candidate) => {
    if (!candidate.includes('*')) return false;
    const [prefix, suffix] = candidate.split('*');
    return subpath.startsWith(prefix) && subpath.endsWith(suffix);
  });
};

const isWithinDirectory = (file, directory) => {
  const relative = path.relative(directory, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
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
const packagesByName = new Map(packages.map((item) => [item.manifest.name, item]));
const productionWorkspaceGraph = new Map(
  packages.map(({ manifest }) => [manifest.name, new Set()]),
);

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
  if (!allowedWorkspace) {
    errors.push(
      `${path.relative(root, directory)}/package.json: missing explicit workspace dependency rule for ${manifest.name}`,
    );
  }

  for (const file of files) {
    const relativeFile = path.relative(root, file);
    const source = await readFile(file, 'utf8');

    for (const specifier of extractSpecifiers(source, file)) {
      if (specifier.startsWith('.')) {
        const resolvedImport = path.resolve(path.dirname(file), specifier);
        if (!isWithinDirectory(resolvedImport, directory)) {
          errors.push(
            `${relativeFile}: relative import escapes package ${manifest.name}: ${specifier}`,
          );
        }
      }
      if (/^@tradejs\/(?:core|node|infra)$/.test(specifier)) {
        errors.push(`${relativeFile}: root package import is forbidden: ${specifier}`);
      }
      if (/^@tradejs\/(?:core|node|infra)\/src(?:\/|$)/.test(specifier)) {
        errors.push(`${relativeFile}: non-public deep import is forbidden: ${specifier}`);
      }
      if (
        specifier === '@tradejs/infra/timescale' &&
        manifest.name !== '@tradejs/infra'
      ) {
        errors.push(
          `${relativeFile}: use a focused @tradejs/infra/timescale/* subpath`,
        );
      }

      const dependency = packageNameFromSpecifier(specifier);
      if (!dependency || builtins.has(specifier) || builtins.has(dependency)) continue;

      const workspaceDependency = packagesByName.get(dependency);
      if (workspaceDependency) {
        const subpath = packageSubpathFromSpecifier(specifier, dependency);
        if (!isExportedSubpath(workspaceDependency.manifest, subpath)) {
          errors.push(
            `${relativeFile}: ${specifier} is not exported by ${dependency}`,
          );
        }
      }

      if (dependency === manifest.name) continue;

      if (!declaredDependencies.has(dependency)) {
        errors.push(
          `${relativeFile}: ${dependency} is imported but not declared by ${manifest.name}`,
        );
      }

      if (workspaceNames.has(dependency)) {
        if (!isTestFile(file)) {
          productionWorkspaceGraph.get(manifest.name)?.add(dependency);
        }
        const testDependencies = allowedTestWorkspaceDependencies.get(manifest.name);
        const allowedForFile =
          allowedWorkspace?.has(dependency) ||
          (isTestFile(file) && testDependencies?.has(dependency));
        if (!allowedForFile) {
          errors.push(
            `${relativeFile}: forbidden package direction ${manifest.name} -> ${dependency}`,
          );
        }
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

const visitWorkspacePackage = (packageName, pathToPackage, visited) => {
  if (pathToPackage.includes(packageName)) {
    const cycleStart = pathToPackage.indexOf(packageName);
    const cycle = [...pathToPackage.slice(cycleStart), packageName];
    errors.push(`workspace dependency cycle: ${cycle.join(' -> ')}`);
    return;
  }
  if (visited.has(packageName)) return;

  const nextPath = [...pathToPackage, packageName];
  for (const dependency of productionWorkspaceGraph.get(packageName) ?? []) {
    visitWorkspacePackage(dependency, nextPath, visited);
  }
  visited.add(packageName);
};

const visitedWorkspacePackages = new Set();
for (const packageName of productionWorkspaceGraph.keys()) {
  visitWorkspacePackage(packageName, [], visitedWorkspacePackages);
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
