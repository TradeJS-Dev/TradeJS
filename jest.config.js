const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './apps/app' });

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/apps/app/src/$1',
    '^@tradejs/connectors$': '<rootDir>/packages/connectors/src/index',
    '^@tradejs/core/api$': '<rootDir>/packages/core/src/api',
    '^@tradejs/core/async$': '<rootDir>/packages/core/src/async',
    '^@tradejs/core/backtest$': '<rootDir>/packages/core/src/backtest',
    '^@tradejs/core/cli$': '<rootDir>/packages/core/src/cli',
    '^@tradejs/core/config$': '<rootDir>/packages/core/src/config',
    '^@tradejs/core/connectors$': '<rootDir>/packages/core/src/connectors',
    '^@tradejs/core/constants$': '<rootDir>/packages/core/src/constants',
    '^@tradejs/core/data$': '<rootDir>/packages/core/src/data',
    '^@tradejs/core/figures$': '<rootDir>/packages/core/src/figures',
    '^@tradejs/core/indicators$': '<rootDir>/packages/core/src/indicators',
    '^@tradejs/core/json$': '<rootDir>/packages/core/src/json',
    '^@tradejs/core/math$': '<rootDir>/packages/core/src/math',
    '^@tradejs/core/pine$': '<rootDir>/packages/core/src/pine',
    '^@tradejs/core/strategies$': '<rootDir>/packages/core/src/strategies',
    '^@tradejs/core/tickers$': '<rootDir>/packages/core/src/tickers',
    '^@tradejs/core/time$': '<rootDir>/packages/core/src/time',
    '^@tradejs/infra$': '<rootDir>/packages/infra/src/index',
    '^@tradejs/base$': '<rootDir>/packages/base/src/index',
    '^@tradejs/strategies$': '<rootDir>/packages/strategies/src/index',
    '^@tradejs/indicators$': '<rootDir>/packages/indicators/src/index',
    '^@tradejs/types$': '<rootDir>/packages/types/src/index',
    '^@tradejs/types/(.*)$': '<rootDir>/packages/types/src/$1',
    '^@app/(.*)$': '<rootDir>/apps/app/src/app/$1',
    '^@actions/(.*)$': '<rootDir>/apps/app/src/app/actions/$1',
    '^@store$': '<rootDir>/apps/app/src/app/store/index',
    '^@constants$': '<rootDir>/packages/core/src/constants/index',
    '^@shared/(.*)$': '<rootDir>/apps/app/src/app/components/Shared/$1',
    '^@utils/(.*)$': '<rootDir>/packages/core/src/utils/$1',
    '^@UI$': '<rootDir>/apps/app/src/app/components/UI/index',
    '^@components/(.*)$': '<rootDir>/apps/app/src/app/components/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  testPathIgnorePatterns: [
    '<rootDir>/.ai/',
    '<rootDir>/dist/',
    '<rootDir>/packages/.*/dist/',
    '<rootDir>/packages/cli/src/scripts/test.ts',
  ],
  testEnvironment: 'jest-environment-jsdom',
};

module.exports = createJestConfig(customJestConfig);
