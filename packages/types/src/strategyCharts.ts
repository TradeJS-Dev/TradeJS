import type { SimpleOrderLogData, TestStat } from './backtest';

export type StrategyChartMetricTone =
  | 'default'
  | 'neutral'
  | 'success'
  | 'warning'
  | 'error';

export interface StrategyChartMetric {
  id: string;
  label: string;
  value: string;
  tone?: StrategyChartMetricTone;
}

export interface StrategyChartDetail {
  id: string;
  label: string;
  value: string;
  tone?: StrategyChartMetricTone;
}

export interface StrategyChartOrder {
  id: string;
  symbol?: string;
  direction?: string | null;
  timestamp?: number | null;
  entryTimestamp?: number | null;
  exitTimestamp?: number | null;
  exitReason?: string | null;
  pnl?: number | null;
  equityBefore?: number | null;
  equityAfter?: number | null;
  qty?: number | null;
  notional?: number | null;
  requestedEntryPrice?: number | null;
  entryPrice?: number | null;
  requestedExitPrice?: number | null;
  exitPrice?: number | null;
  openFee?: number | null;
  closeFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
  entrySlippageBps?: number | null;
  entryBaseSlippageBps?: number | null;
  entrySpreadBps?: number | null;
  entrySpreadSlippageBps?: number | null;
  entryMarketImpactBps?: number | null;
  entryDelayRiskBps?: number | null;
  exitSlippageBps?: number | null;
  exitBaseSlippageBps?: number | null;
  exitSpreadBps?: number | null;
  exitSpreadSlippageBps?: number | null;
  exitMarketImpactBps?: number | null;
  exitDelayRiskBps?: number | null;
  totalSlippageCost?: number | null;
  sequence?: number | null;
}

export interface StrategyChartSnapshot {
  cardId: string;
  generatedAt: number;
  strategyName: string;
  title: string;
  subtitle?: string;
  datasetId?: string;
  symbols: string[];
  orderLog: SimpleOrderLogData;
  orders: StrategyChartOrder[];
  stat?: Partial<TestStat> | null;
  metrics: StrategyChartMetric[];
  details?: StrategyChartDetail[];
  tags?: string[];
}

export interface StrategyChartsSnapshotResponse {
  mode: 'replay' | 'ai';
  generatedAt: number;
  runLabel: string;
  strategies: StrategyChartSnapshot[];
}
