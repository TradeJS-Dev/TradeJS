export * from '@tradejs/core/backtest';
export {
  canRunTestsInSharedCandleLoop,
  releaseTestingSymbolCache,
  resetTestingKlineCache,
  testing,
  testingGroupInSharedCandleLoop,
} from './testing';
export { createTestConnector } from './testConnector';
