import type { SimpleOrderLogData, TestStat } from './backtest';

export type StrategyChartMetricTone =
  | 'default'
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

export interface StrategyChartSnapshot {
  cardId: string;
  generatedAt: number;
  strategyName: string;
  title: string;
  subtitle?: string;
  datasetId?: string;
  symbols: string[];
  orderLog: SimpleOrderLogData;
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
