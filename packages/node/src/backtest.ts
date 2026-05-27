export * from '@tradejs/core/backtest';
export {
  canRunTestsInSharedCandleLoop,
  releaseTestingSymbolCache,
  resetTestingKlineCache,
  testing,
  testingGroupInSharedCandleLoop,
  warmBacktestIndicatorCache,
} from './testing';
export { createTestConnector } from './testConnector';
