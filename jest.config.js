const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@src/(.*)$': '<rootDir>/src/$1',
    '^@app/(.*)$': '<rootDir>/src/app/$1',
    '^@actions/(.*)$': '<rootDir>/src/app/actions/$1',
    '^@store$': '<rootDir>/src/app/store/index',
    '^@constants$': '<rootDir>/src/constants/index',
    '^@types$': '<rootDir>/src/types/index',
    '^@shared/(.*)$': '<rootDir>/src/app/components/Shared/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@UI$': '<rootDir>/src/app/components/UI/index',
    '^@components/(.*)$': '<rootDir>/src/app/components/$1',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/.ai/',
    '<rootDir>/src/scripts/test.ts',
  ],
  testEnvironment: 'jest-environment-jsdom',
};

module.exports = createJestConfig(customJestConfig);
