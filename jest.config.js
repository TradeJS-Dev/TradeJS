const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './apps/app' });

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/apps/app/src/$1',
    '^@tradejs/connectors$': '<rootDir>/packages/connectors/src/index',
    '^@tradejs/connectors/(.*)$': '<rootDir>/packages/connectors/src/$1',
    '^@tradejs/core$': '<rootDir>/packages/core/src/index',
    '^@tradejs/core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^@app/(.*)$': '<rootDir>/apps/app/src/app/$1',
    '^@actions/(.*)$': '<rootDir>/apps/app/src/app/actions/$1',
    '^@store$': '<rootDir>/apps/app/src/app/store/index',
    '^@constants$': '<rootDir>/packages/core/src/constants/index',
    '^@types$': '<rootDir>/packages/core/src/types/index',
    '^@shared/(.*)$': '<rootDir>/apps/app/src/app/components/Shared/$1',
    '^@utils/(.*)$': '<rootDir>/packages/core/src/utils/$1',
    '^@UI$': '<rootDir>/apps/app/src/app/components/UI/index',
    '^@components/(.*)$': '<rootDir>/apps/app/src/app/components/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/.ai/',
    '<rootDir>/packages/cli/src/scripts/test.ts',
  ],
  testEnvironment: 'jest-environment-jsdom',
};

module.exports = createJestConfig(customJestConfig);
