import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(migrationRoot, '../..');
const catalog = JSON.parse(
  fs.readFileSync(path.join(migrationRoot, 'catalog.json'), 'utf8'),
);

const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};

const outputRoot = path.resolve(
  readArgument('--output-root') ?? path.join(repositoryRoot, '..'),
);

const fail = (message) => {
  throw new Error(message);
};

const lowerFirst = (value) => value[0].toLowerCase() + value.slice(1);

const toKebabCase = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

const toLocalDirectory = (repository) => {
  const suffix = repository.replace(/^TradeJS-/, '');
  return `tradejs-${toKebabCase(suffix)}`;
};

const walkFiles = (root) =>
  fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
  });

const readTypeScriptSources = (sourcePaths) =>
  sourcePaths
    .flatMap((sourcePath) => walkFiles(path.join(repositoryRoot, sourcePath)))
    .filter((filePath) => filePath.endsWith('.ts'))
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

const findExportedConst = (contents, pattern, sourceLabel) => {
  const match = contents.match(pattern);
  if (!match) fail(`Cannot resolve ${sourceLabel}`);
  return match[1];
};

const findAllExportedConsts = (contents, pattern) =>
  [...contents.matchAll(pattern)].map((match) => match[1]);

const buildPackageIndex = (strategies) => {
  const imports = [
    "import { defineStrategyPlugin } from '@tradejs/core/config';",
    "import type { StrategyConfig, StrategyRegistryEntry } from '@tradejs/types';",
  ];
  const publicExports = [];
  const definitions = [];
  const configs = [];

  for (const strategy of strategies) {
    const strategyRoot = path.join(repositoryRoot, strategy.sourcePath);
    const strategyContents = fs.readFileSync(
      path.join(strategyRoot, 'strategy.ts'),
      'utf8',
    );
    const definition = findExportedConst(
      strategyContents,
      /export const\s+(\w+StrategyDefinition)\b/,
      `${strategy.name} strategy definition`,
    );
    const configAlias = `${lowerFirst(strategy.name)}DefaultConfig`;
    definitions.push(definition);
    configs.push({ name: strategy.name, alias: configAlias });
    imports.push(
      `import { config as ${configAlias} } from './${strategy.name}/config';`,
      `import { ${definition} } from './${strategy.name}/strategy';`,
    );
    publicExports.push(
      `export { ${definition} } from './${strategy.name}/strategy';`,
      `export { ${configAlias} };`,
    );

    const manifestPath = path.join(strategyRoot, 'manifest.ts');
    if (fs.existsSync(manifestPath)) {
      const manifestContents = fs.readFileSync(manifestPath, 'utf8');
      const manifests = findAllExportedConsts(
        manifestContents,
        /export const\s+(\w+Manifest)\b/g,
      );
      for (const manifest of manifests) {
        publicExports.push(
          `export { ${manifest} } from './${strategy.name}/manifest';`,
        );
      }
    }

    const adaptersRoot = path.join(strategyRoot, 'adapters');
    if (fs.existsSync(adaptersRoot)) {
      for (const adapterPath of walkFiles(adaptersRoot).filter((filePath) =>
        filePath.endsWith('.ts'),
      )) {
        const adapterContents = fs.readFileSync(adapterPath, 'utf8');
        const adapters = findAllExportedConsts(
          adapterContents,
          /export const\s+(\w+(?:Ai|Ml)Adapter)\b/g,
        );
        const relativeAdapterPath = path
          .relative(strategyRoot, adapterPath)
          .replaceAll(path.sep, '/')
          .replace(/\.ts$/, '');
        for (const adapter of adapters) {
          publicExports.push(
            `export { ${adapter} } from './${strategy.name}/${relativeAdapterPath}';`,
          );
        }
      }
    }
  }

  return `${imports.join('\n')}

export const strategyEntries: StrategyRegistryEntry[] = [
${definitions.map((definition) => `  ${definition},`).join('\n')}
];

const defaultConfigs: Record<string, StrategyConfig> = {
${configs.map(({ name, alias }) => `  ${name}: ${alias},`).join('\n')}
};

export const getBuiltInStrategyDefaultConfig = (
  strategyName: string,
): StrategyConfig | undefined => defaultConfigs[strategyName];

${publicExports.join('\n')}

export default defineStrategyPlugin({ strategyEntries });
`;
};

const buildPackageJson = ({ repository, packageName, strategies, sources }) => {
  const dependencies = {
    '@tradejs/core': '^3.0.1',
    '@tradejs/types': '^3.0.1',
  };
  if (sources.includes('@tradejs/indicators')) {
    dependencies['@tradejs/indicators'] = '^3.0.1';
  }
  if (sources.includes('@tradejs/strategy-kit')) {
    dependencies['@tradejs/strategy-kit'] = '^3.0.0';
  }
  if (sources.includes("from 'technicalindicators'")) {
    dependencies.technicalindicators = '^3.1.0';
  }

  return {
    name: packageName,
    version: '3.0.0',
    description:
      strategies.length === 1
        ? `${strategies[0].name} strategy plugin for TradeJS.`
        : `${strategies.map((strategy) => strategy.name).join(' and ')} strategy family plugin for TradeJS.`,
    type: 'module',
    packageManager: 'yarn@4.13.0',
    engines: { node: '24.x' },
    keywords: ['tradejs', 'trading', 'strategy', 'plugin', 'backtesting'],
    homepage: 'https://tradejs.dev',
    repository: {
      type: 'git',
      url: `https://github.com/TradeJS-Dev/${repository}`,
    },
    bugs: {
      url: `https://github.com/TradeJS-Dev/${repository}/issues`,
    },
    main: './dist/index.cjs',
    module: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist'],
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        require: './dist/index.cjs',
      },
    },
    sideEffects: false,
    dependencies,
    devDependencies: {
      '@types/jest': '^29.5.14',
      jest: '^29.7.0',
      prettier: '^3.6.2',
      'ts-jest': '^29.2.5',
      tsup: '^8.5.1',
      typescript: '^5.9.2',
    },
    scripts: {
      build: 'tsup',
      'format:check': 'prettier --check .',
      test: 'jest --runInBand',
      typecheck: 'tsc -p ./tsconfig.json --noEmit',
      checks: 'yarn format:check && yarn typecheck && yarn test && yarn build',
    },
    publishConfig: {
      access: 'public',
      provenance: true,
    },
    license: 'BUSL-1.1',
    author: 'aleksnick (https://github.com/aleksnick)',
  };
};

const buildReadme = ({ packageName, strategies }) => {
  const strategyNames = strategies.map((strategy) => strategy.name);
  const registration = JSON.stringify(packageName);
  const familyNote =
    strategyNames.length > 1
      ? `\nThis is the single explicit grouped package in the TradeJS strategy catalog. ${strategyNames.join(' and ')} share trendline mechanics and are versioned atomically. There is no separate trendline family-kit package.\n`
      : '';

  return `# ${packageName}

TradeJS strategy plugin providing ${strategyNames.map((name) => `\`${name}\``).join(' and ')}.
${familyNote}
## Install

\`\`\`bash
yarn add ${packageName}
\`\`\`

Register the package in \`tradejs.config.ts\`:

\`\`\`ts
import { defineConfig } from '@tradejs/core/config';

export default defineConfig({
  strategies: [${registration}],
});
\`\`\`

The package exports \`strategyEntries\` for the TradeJS plugin loader together
with its strategy definitions, manifests, default configs, and public AI/ML
adapters. Strategy implementation changes are released from this repository,
independently of the TradeJS engine.

## Development

\`\`\`bash
yarn install --immutable
yarn checks
\`\`\`

Publishing is triggered by a GitHub release and delegated to the pinned
\`TradeJS-Workflows@v1\` reusable workflow.
`;
};

const buildAgents = ({ strategies }) => `# AGENTS.md

## Scope

These rules apply to this complete strategy repository.

## Ownership

This repository owns ${strategies.map((strategy) => `\`${strategy.name}\``).join(' and ')} strategy behavior, configuration, adapters, figures, and tests.

## Architecture

- Export the TradeJS plugin contract through \`strategyEntries\`.
- Keep detector engines pure and replay-safe.
- Keep StrategyAPI side effects, position checks, risk plans, and entries/exits
  in each strategy's \`core.ts\`.
- Import neutral helpers from public \`@tradejs/strategy-kit/*\` subpaths.
- Do not add strategy-specific branches to TradeJS core, indicators, or Strategy
  Kit.
- Do not import source files from another strategy repository.
${strategies.length > 1 ? '- Keep the shared TrendLine family mechanics in this repository; both strategies must remain releasable as one package.\n' : ''}
## Verification

Run \`yarn checks\` before every commit. Keep CI and release workflows as thin
callers of the pinned reusable workflows in \`TradeJS-Workflows\`.
`;

const staticFiles = {
  '.gitignore': `dist/
node_modules/
.yarn/install-state.gz
*.tgz
`,
  '.prettierignore': `dist/
node_modules/
yarn.lock
`,
  '.yarnrc.yml': `nodeLinker: node-modules
npmPublishRegistry: https://registry.npmjs.org
`,
  'jest.config.cjs': `module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.json',
      },
    ],
  },
};
`,
  'tsconfig.json': `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        skipLibCheck: true,
        noEmit: true,
        types: ['jest', 'node'],
      },
      include: ['src/**/*.ts'],
      exclude: ['dist', 'node_modules'],
    },
    null,
    2,
  )}\n`,
  'tsconfig.build.json': `${JSON.stringify(
    {
      extends: './tsconfig.json',
      compilerOptions: { noEmit: false },
      exclude: [
        'dist',
        'node_modules',
        'src/**/__tests__/**',
        'src/**/*.test.ts',
      ],
    },
    null,
    2,
  )}\n`,
  'tsup.config.ts': `import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  tsconfig: './tsconfig.build.json',
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  external: [/^@tradejs\\//, 'technicalindicators'],
});
`,
  '.github/workflows/ci.yml': `name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  checks:
    uses: TradeJS-Dev/TradeJS-Workflows/.github/workflows/strategy-ci.yml@v1
`,
  '.github/workflows/release.yml': `name: Release

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

concurrency:
  group: npm-release-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  publish:
    uses: TradeJS-Dev/TradeJS-Workflows/.github/workflows/strategy-publish.yml@v1
    secrets:
      npm-token: \${{ secrets.NPM_TOKEN }}
`,
};

const licenseTemplate = fs.readFileSync(
  path.join(repositoryRoot, 'LICENSE'),
  'utf8',
);

const unitsByRepository = new Map();
for (const strategy of catalog.strategies) {
  const unit = unitsByRepository.get(strategy.repository) ?? {
    repository: strategy.repository,
    packageName: strategy.packageName,
    strategies: [],
  };
  if (unit.packageName !== strategy.packageName) {
    fail(`${strategy.repository} maps to multiple package names`);
  }
  unit.strategies.push(strategy);
  unitsByRepository.set(strategy.repository, unit);
}

const units = [...unitsByRepository.values()];
for (const unit of units) {
  unit.targetRoot = path.join(outputRoot, toLocalDirectory(unit.repository));
  if (fs.existsSync(unit.targetRoot)) {
    fail(`Target already exists: ${unit.targetRoot}`);
  }
  for (const strategy of unit.strategies) {
    if (!fs.existsSync(path.join(repositoryRoot, strategy.sourcePath))) {
      fail(`Missing strategy source: ${strategy.sourcePath}`);
    }
  }
}

for (const unit of units) {
  const sources = readTypeScriptSources(
    unit.strategies.map((strategy) => strategy.sourcePath),
  );
  fs.mkdirSync(path.join(unit.targetRoot, 'src'), { recursive: true });
  for (const strategy of unit.strategies) {
    fs.cpSync(
      path.join(repositoryRoot, strategy.sourcePath),
      path.join(unit.targetRoot, 'src', strategy.name),
      { recursive: true },
    );
  }
  if (sources.includes('../../testUtils/')) {
    fs.cpSync(
      path.join(repositoryRoot, 'packages/strategies/src/testUtils'),
      path.join(unit.targetRoot, 'src/testUtils'),
      { recursive: true },
    );
  }

  const packageJson = buildPackageJson({ ...unit, sources });
  const generatedFiles = {
    ...staticFiles,
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'src/index.ts': buildPackageIndex(unit.strategies),
    'README.md': buildReadme(unit),
    'AGENTS.md': buildAgents(unit),
    LICENSE: licenseTemplate.replace(
      /Licensed Work:[\s\S]*?\n\nAdditional Use Grant:/,
      `Licensed Work: ${unit.packageName} version 3.0.0 and later.\n\nAdditional Use Grant:`,
    ),
  };

  for (const [relativePath, contents] of Object.entries(generatedFiles)) {
    const filePath = path.join(unit.targetRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  process.stdout.write(
    `${unit.repository}\t${unit.packageName}\t${unit.targetRoot}\n`,
  );
}

process.stdout.write(
  `Created ${units.length} strategy repository working trees for ${catalog.strategies.length} strategies.\n`,
);
