export {
  buildRuntimeStrategyAnalytics,
  isRuntimeTradeRecord,
  resolveStrategyNameByOrderLinkId,
  selectTradesForWindow,
  toRuntimeTradeView,
} from '@tradejs/core/backtest';
export {
  buildExchangeFallbackRuntimeTrades,
  takeClosedPnlMatch,
  takeExactClosedPnlMatch,
} from '@tradejs/node/runtimeTrades';
export type { ClosedPnlRecordWithOrderLinkId } from '@tradejs/node/runtimeTrades';

export type {
  RuntimeStrategiesResponse,
  RuntimeStrategyTradeSummary,
  RuntimeStrategyTradeView,
  RuntimeStrategyView,
} from './runtimeStrategyContracts';
export {
  assignLegacyRuntimeTradeAccountScopes,
  buildRuntimeStrategyAiGateChanges,
  buildRuntimeStrategyIdentityKey,
  buildRuntimeStrategyMaxLossValueTimeline,
  getRuntimeStrategyAiGateObservedFrom,
  isRuntimeStrategyLineageScope,
} from './runtimeStrategyLineage';
export type {
  RuntimeStrategyAccountScope,
  RuntimeStrategyAiGateChange,
  RuntimeStrategyLineageScope,
  RuntimeStrategyMaxLossValueChange,
  RuntimeStrategyMaxLossValueTimeline,
} from './runtimeStrategyLineage';
