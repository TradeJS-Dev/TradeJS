const { FlatCompat } = require('@eslint/eslintrc');
const typescriptEslintPlugin = require('@typescript-eslint/eslint-plugin');

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const unusedVarsOptions = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  ignoreRestSiblings: true,
};

module.exports = [
  {
    ignores: ['**/dist/**', '**/.next/**'],
  },
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      'no-duplicate-imports': 'error',
      'no-unused-vars': ['warn', unusedVarsOptions],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: {
      '@typescript-eslint': typescriptEslintPlugin,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', unusedVarsOptions],
    },
  },
  {
    files: [
      'apps/**/*.{ts,tsx,js,jsx}',
      'packages/**/*.{ts,tsx,js,jsx}',
      'examples/**/*.{ts,tsx,js,jsx}',
    ],
    ignores: ['packages/core/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tradejs/core',
              message:
                'Use explicit public subpaths like @tradejs/core/config, @tradejs/core/strategies, @tradejs/core/indicators, @tradejs/core/backtest, @tradejs/core/math, @tradejs/core/time.',
            },
            {
              name: '@tradejs/infra',
              message:
                'Use explicit public subpaths like @tradejs/infra/redis, @tradejs/infra/logger, @tradejs/infra/http, @tradejs/infra/files, @tradejs/infra/ml, @tradejs/infra/timescale.',
            },
            {
              name: '@tradejs/node',
              message:
                'Use explicit public subpaths like @tradejs/node/strategies, @tradejs/node/connectors, @tradejs/node/backtest, @tradejs/node/registry.',
            },
          ],
          patterns: [
            '@utils/*',
            '@constants',
            '@types',
            '@tradejs/core/src/*',
            '@tradejs/core/dist/*',
            '@tradejs/core/*/*',
            '@tradejs/infra/src/*',
            '@tradejs/infra/dist/*',
            '@tradejs/infra/*/*',
            '@tradejs/node/src/*',
            '@tradejs/node/dist/*',
            '@tradejs/node/*/*',
          ],
        },
      ],
    },
  },
];
