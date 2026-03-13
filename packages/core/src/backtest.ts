export * from './utils/grid';
export * from './utils/tests';
export * from './utils/stat';
export { compactOrderLog, getTimeline } from './utils/timestamp';

type TestingModule = typeof import('./utils/testing');
type TestConnectorModule = typeof import('./utils/testConnector');

const getNodeRequire = (): NodeJS.Require => {
  try {
    return eval('require') as NodeJS.Require;
  } catch {
    throw new Error(
      '@tradejs/core/backtest server-only exports are not available in this environment',
    );
  }
};

const getTestingModule = (): TestingModule =>
  getNodeRequire()('./utils/testing') as TestingModule;

const getTestConnectorModule = (): TestConnectorModule =>
  getNodeRequire()('./utils/testConnector') as TestConnectorModule;

export const resetTestingKlineCache = (
  ...args: Parameters<TestingModule['resetTestingKlineCache']>
): ReturnType<TestingModule['resetTestingKlineCache']> =>
  getTestingModule().resetTestingKlineCache(...args);

export const testing = (
  ...args: Parameters<TestingModule['testing']>
): ReturnType<TestingModule['testing']> => getTestingModule().testing(...args);

export const createTestConnector = (
  ...args: Parameters<TestConnectorModule['createTestConnector']>
): ReturnType<TestConnectorModule['createTestConnector']> =>
  getTestConnectorModule().createTestConnector(...args);
