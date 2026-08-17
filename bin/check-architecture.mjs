import { builtinModules } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import ts from 'typescript';
import architectureGraph from './architectureGraph.cjs';

const {
  getPublicExportEntries,
  validateManifestWorkspaceGraph,
  validatePublicExportShape,
} = architectureGraph;

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs']);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const ignoredSourceDirectories = new Set([
  '.next',
  '.yarn',
  'dist',
  'node_modules',
]);
const subpathFirstPackageNames = new Set([
  '@tradejs/core',
  '@tradejs/infra',
  '@tradejs/node',
  '@tradejs/strategy-kit',
]);

const allowedWorkspaceDependencies = new Map([
  ['@tradejs/types', new Set()],
  ['@tradejs/core', new Set(['@tradejs/types'])],
  ['@tradejs/infra', new Set(['@tradejs/types'])],
  ['@tradejs/strategy-kit', new Set(['@tradejs/core', '@tradejs/types'])],
  ['@tradejs/strategy-trendline-kit', new Set()],
  ['@tradejs/indicators', new Set(['@tradejs/core', '@tradejs/types'])],
  [
    '@tradejs/strategies',
    new Set([
      '@tradejs/core',
      '@tradejs/indicators',
      '@tradejs/strategy-kit',
      '@tradejs/strategy-trendline-kit',
      '@tradejs/types',
    ]),
  ],
  [
    '@tradejs/node',
    new Set(['@tradejs/core', '@tradejs/infra', '@tradejs/types']),
  ],
  [
    '@tradejs/connectors',
    new Set(['@tradejs/core', '@tradejs/types']),
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
      if (entry.isDirectory()) {
        return ignoredSourceDirectories.has(entry.name)
          ? []
          : listSourceFiles(entryPath);
      }
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

const resolveSourceFile = (basePath, fileSet) => {
  const candidates = [
    basePath,
    ...[...sourceExtensions].map((extension) => `${basePath}${extension}`),
    ...[...sourceExtensions].map((extension) =>
      path.join(basePath, `index${extension}`),
    ),
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
};

const resolvePackageLocalImport = ({
  file,
  specifier,
  manifest,
  fileSet,
  directory,
}) => {
  if (specifier.startsWith('.')) {
    return resolveSourceFile(path.resolve(path.dirname(file), specifier), fileSet);
  }
  if (!specifier.startsWith('#')) return null;

  for (const [pattern, target] of Object.entries(manifest.imports ?? {})) {
    const wildcardIndex = pattern.indexOf('*');
    const matches =
      wildcardIndex < 0
        ? specifier === pattern
        : specifier.startsWith(pattern.slice(0, wildcardIndex)) &&
          specifier.endsWith(pattern.slice(wildcardIndex + 1));
    if (!matches || typeof target !== 'string') continue;

    const wildcard =
      wildcardIndex < 0
        ? ''
        : specifier.slice(
            wildcardIndex,
            specifier.length - (pattern.length - wildcardIndex - 1),
          );
    const resolvedTarget = target.replace('*', wildcard);
    return resolveSourceFile(path.resolve(directory, resolvedTarget), fileSet);
  }

  return null;
};

const findStronglyConnectedComponents = (graph) => {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  const visit = (node) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), lowLinks.get(dependency)),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          node,
          Math.min(lowLinks.get(node), indices.get(dependency)),
        );
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    let current;
    do {
      current = stack.pop();
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1) components.push(component);
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
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

const manifestGraphValidation = validateManifestWorkspaceGraph({
  packages,
  allowedWorkspaceDependencies,
});
errors.push(...manifestGraphValidation.errors);
errors.push(
  ...validatePublicExportShape({ packages, subpathFirstPackageNames }),
);

for (const { directory, manifest } of packages) {
  const publicExports = getPublicExportEntries(manifest);
  if (publicExports.length === 0) continue;

  const tsupConfigPath = path.join(directory, 'tsup.config.ts');
  if (!existsSync(tsupConfigPath)) {
    errors.push(
      `${path.relative(root, directory)}/package.json: public exports require tsup.config.ts`,
    );
    continue;
  }

  const tsupConfig = await readFile(tsupConfigPath, 'utf8');
  const tsupEntrypoints = new Set(
    [...tsupConfig.matchAll(/['"](src\/[^'"]+\.[cm]?[jt]sx?)['"]/g)].map(
      ([, entrypoint]) => entrypoint,
    ),
  );

  for (const [subpath] of publicExports) {
    const sourceName = subpath === '.' ? 'index' : subpath.slice(2);
    const sourceCandidates = [
      `src/${sourceName}.ts`,
      `src/${sourceName}.tsx`,
      `src/${sourceName}/index.ts`,
      `src/${sourceName}/index.tsx`,
    ];
    const sourceEntrypoint = sourceCandidates.find((candidate) =>
      existsSync(path.join(directory, candidate)),
    );

    if (!sourceEntrypoint) {
      errors.push(
        `${path.relative(root, directory)}/package.json: export ${subpath} has no matching source entry`,
      );
      continue;
    }
    if (!tsupEntrypoints.has(sourceEntrypoint)) {
      errors.push(
        `${path.relative(root, tsupConfigPath)}: export ${subpath} source ${sourceEntrypoint} is missing from tsup entrypoints`,
      );
    }
  }
}

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

const sandboxDirectory = path.join(root, 'examples/sandbox');
const sandboxManifestPath = path.join(sandboxDirectory, 'package.json');
if (existsSync(sandboxManifestPath)) {
  const sandboxManifest = JSON.parse(await readFile(sandboxManifestPath, 'utf8'));
  const sandboxDependencies = {
    ...sandboxManifest.dependencies,
    ...sandboxManifest.devDependencies,
  };

  for (const [dependency, version] of Object.entries(sandboxDependencies)) {
    if (
      dependency.startsWith('@tradejs/') &&
      /^(?:file|link|portal|workspace):/.test(version)
    ) {
      errors.push(
        `examples/sandbox/package.json: ${dependency} must consume a published package version`,
      );
    }
  }

  const sandboxFiles = await listSourceFiles(sandboxDirectory);
  for (const file of sandboxFiles) {
    const relativeFile = path.relative(root, file);
    const source = await readFile(file, 'utf8');
    for (const specifier of extractSpecifiers(source, file)) {
      if (/^@tradejs\/(?:core|node|infra)$/.test(specifier)) {
        errors.push(
          `${relativeFile}: external sandbox uses forbidden root package import ${specifier}`,
        );
      }
      if (/^@tradejs\/(?:core|node|infra)\/src(?:\/|$)/.test(specifier)) {
        errors.push(
          `${relativeFile}: external sandbox uses non-public deep import ${specifier}`,
        );
      }

      const dependency = packageNameFromSpecifier(specifier);
      const workspaceDependency = dependency
        ? packagesByName.get(dependency)
        : undefined;
      if (!dependency || !workspaceDependency) continue;

      if (!Object.prototype.hasOwnProperty.call(sandboxDependencies, dependency)) {
        errors.push(
          `${relativeFile}: ${dependency} is imported but not declared by ${sandboxManifest.name}`,
        );
      }
      const subpath = packageSubpathFromSpecifier(specifier, dependency);
      if (!isExportedSubpath(workspaceDependency.manifest, subpath)) {
        errors.push(
          `${relativeFile}: ${specifier} is not exported by ${dependency}`,
        );
      }
    }
  }
}

for (const packageInfo of packages) {
  const productionFiles = packageInfo.files.filter((file) => !isTestFile(file));
  const fileSet = new Set(productionFiles);
  const sources = new Map(
    await Promise.all(
      productionFiles.map(async (file) => [file, await readFile(file, 'utf8')]),
    ),
  );
  const graph = new Map(productionFiles.map((file) => [file, new Set()]));

  for (const file of productionFiles) {
    for (const specifier of extractSpecifiers(sources.get(file), file)) {
      const dependency = resolvePackageLocalImport({
        file,
        specifier,
        manifest: packageInfo.manifest,
        fileSet,
        directory: packageInfo.directory,
      });
      if (dependency) graph.get(file).add(dependency);
    }
  }

  for (const component of findStronglyConnectedComponents(graph)) {
    errors.push(
      `${packageInfo.manifest.name}: intra-package import cycle: ${component
        .map((file) => path.relative(packageInfo.directory, file))
        .sort()
        .join(' <-> ')}`,
    );
  }

  if (packageInfo.manifest.name !== '@tradejs/app') continue;
  const forbiddenClientPackages = new Set([
    '@tradejs/connectors',
    '@tradejs/infra',
    '@tradejs/node',
    '@tradejs/strategies',
  ]);
  const clientEntries = productionFiles.filter((file) =>
    /^\s*['"]use client['"];?/m.test(sources.get(file)),
  );

  for (const entry of clientEntries) {
    const visited = new Set();
    const queue = [entry];
    while (queue.length) {
      const file = queue.shift();
      if (!file || visited.has(file)) continue;
      visited.add(file);
      for (const specifier of extractSpecifiers(sources.get(file), file)) {
        const dependencyName = packageNameFromSpecifier(specifier);
        if (dependencyName && forbiddenClientPackages.has(dependencyName)) {
          errors.push(
            `${path.relative(root, entry)}: client graph reaches server package ${specifier} via ${path.relative(root, file)}`,
          );
        }
        const localDependency = resolvePackageLocalImport({
          file,
          specifier,
          manifest: packageInfo.manifest,
          fileSet,
          directory: packageInfo.directory,
        });
        if (localDependency && !visited.has(localDependency)) {
          queue.push(localDependency);
        }
      }
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
