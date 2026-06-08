import chalk from 'chalk';
import {
  Interval,
  RuntimeSignalEvaluationRecord,
  Signal,
  StrategyConfig,
} from '@tradejs/types';
import { buildRuntimeModeStrategyConfig } from '../runtimeModeConfig';

export const REPLAY_RESULTS_BY_STRATEGY_HEADERS = [
  chalk.blue('STRATEGY'),
  chalk.yellow('TICKERS'),
  chalk.yellow('TRADE TICKERS'),
  chalk.cyan('ORDERS'),
  chalk.cyan('WIN/LOSS (%)'),
  chalk.cyan('PROFIT'),
  chalk.cyan('AVG TRADE'),
];

export const REPLAY_RUNTIME_COMPARISON_HEADERS = [
  chalk.blue('STRATEGY'),
  chalk.cyan('BT ENTRIES'),
  chalk.cyan('BT PNL'),
  chalk.yellow('RT TRADES'),
  chalk.yellow('RT PNL'),
  chalk.green('MATCHED'),
  chalk.yellow('RT ONLY'),
  chalk.magenta('BT ONLY'),
];

export const REPLAY_RESULTS_CONFIG = 'replay';
export const REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS: number = 2;
export const REPLAY_RUNTIME_COMPARE_TOLERANCE_MS =
  REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS * 15 * 60 * 1000;

export const formatReplayRuntimeCompareTolerance = () =>
  `${REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS} ${
    REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS === 1 ? 'bar' : 'bars'
  }`;

export type ReplayStrategySummary = {
  strategyName: string;
  strategyConfig: StrategyConfig;
  tickers: number;
  tickersWithTrades: number;
  orders: number;
  wins: number;
  losses: number;
  netProfit: number;
  avgTradeProfit: number;
  winRate: number;
};

export type ReplayRuntimeParityRow = {
  strategyName: string;
  backtestEntries: number;
  backtestNetProfit: number;
  runtimeTrades: number;
  runtimePnl: number;
  matched: number;
  runtimeOnly: number;
  backtestOnly: number;
};

export type ReplayParityEntryDetail = {
  source: 'runtime' | 'exchange' | 'backtest';
  strategy?: string | null;
  inferredStrategy?: string | null;
  symbol: string;
  direction: string;
  qty?: number | null;
  timestamp: number;
  comparisonTimestamp?: number | null;
  price: number | null;
  exitType?: string | null;
  exitTimestamp?: number | null;
  exitPrice?: number | null;
  pnl?: number | null;
  costs?: {
    entryFee: number | null;
    exitFee: number | null;
    fundingFee: number | null;
    totalFee: number | null;
  };
  orderId?: string;
  orderLinkId?: string;
  signalId?: string;
};

export type ReplayParityMatchedPnlComparison = {
  expectedPnl: number | null;
  realizedPnl: number | null;
  delta: number | null;
};

export type ReplayParityMatchedSlippage = {
  entryPriceDeltaPct: number | null;
  exitPriceDeltaPct: number | null;
  entryCost: number | null;
  exitCost: number | null;
  totalCost: number | null;
};

export type ReplayParityMatchedExitType = {
  expected: string | null;
  actual: string | null;
  matches: boolean | null;
};

export type ReplayParityNearestCandidate = {
  entry: ReplayParityEntryDetail;
  nearest: ReplayParityEntryDetail | null;
  timestampDiffMs: number | null;
  priceDeltaPct: number | null;
  reason:
    | 'no_candidate_same_symbol_direction'
    | 'outside_tolerance'
    | 'candidate_already_matched';
};

export type ReplayMismatchAiDiagnostic = {
  direction: string | null;
  quality: number | null;
  needRetest: boolean | null;
  gateDecision: string | null;
  llmDecision: string | null;
  qualityReason: string | null;
};

export type ReplayMismatchSignalDiagnostic = {
  signalId?: string;
  timestamp: number;
  timestampDiffMs: number;
  direction?: string;
  orderStatus?: string;
  orderSkipReason?: string;
  ai: ReplayMismatchAiDiagnostic | null;
  ml: {
    probability: number;
    threshold: number;
    passed: boolean;
  } | null;
};

export type ReplayMismatchEvaluationDiagnostic = {
  evaluationId: string;
  timestamp: number;
  timestampDiffMs: number;
  status: string;
  reason?: string;
  signalId?: string;
  direction?: string;
  orderStatus?: string;
  orderSkipReason?: string;
  ai: ReplayMismatchAiDiagnostic | null;
  ml: {
    probability: number;
    threshold: number;
    passed: boolean;
  } | null;
};

export type ReplayMismatchDiagnostic = {
  entry: ReplayParityEntryDetail;
  classification: string;
  reason: string;
  nearestCandidate?: ReplayParityNearestCandidate;
  runtimeSignal?: ReplayMismatchSignalDiagnostic;
  runtimeSignalArtifact?: Signal;
  runtimeEvaluation?: ReplayMismatchEvaluationDiagnostic;
  runtimeEvaluationArtifact?: RuntimeSignalEvaluationRecord;
  replaySignal?: ReplayMismatchSignalDiagnostic;
  replaySignalArtifact?: Signal;
  replayEvaluation?: ReplayMismatchEvaluationDiagnostic;
  replayEvaluationArtifact?: RuntimeSignalEvaluationRecord;
};

export type ReplayMismatchDrilldown = {
  runtimeOnly: ReplayMismatchDiagnostic[];
  backtestOnly: ReplayMismatchDiagnostic[];
  summary: {
    runtimeOnly: Record<string, number>;
    backtestOnly: Record<string, number>;
    artifacts?: {
      limit: number;
      runtimeOnlyIncluded: number;
      runtimeOnlyOmitted: number;
      backtestOnlyIncluded: number;
      backtestOnlyOmitted: number;
    };
  };
};

export type ReplayRuntimeComparisonDetails = {
  capped: boolean;
  limit: number;
  matched: Array<{
    runtime: ReplayParityEntryDetail;
    backtest: ReplayParityEntryDetail;
    timestampDiffMs: number;
    priceDeltaPct: number | null;
    exitTimestampDiffMs: number | null;
    exitPriceDeltaPct: number | null;
    exitType: ReplayParityMatchedExitType;
    pnl: ReplayParityMatchedPnlComparison;
    slippage: ReplayParityMatchedSlippage;
  }>;
  runtimeOnly: ReplayParityEntryDetail[];
  backtestOnly: ReplayParityEntryDetail[];
  nearestCandidates: ReplayParityNearestCandidate[];
  mismatchDrilldown?: ReplayMismatchDrilldown;
};

export type ReplayRuntimeComparisonSummary = {
  mode: 'runtime' | 'exchange';
  syncedTradesCount: number;
  windowTradesCount: number;
  runtimeEntriesCount: number;
  backtestEntriesCount: number;
  matchedCount: number;
  runtimeOnlyCount: number;
  backtestOnlyCount: number;
  rows: ReplayRuntimeParityRow[];
  details?: ReplayRuntimeComparisonDetails;
};

export type ReplayStrategyResultsSnapshot = {
  summaries: ReplayStrategySummary[];
  backtestEntries: any[];
};

export const buildReplayStrategyConfig = ({
  strategyConfig,
  interval,
}: {
  strategyConfig: StrategyConfig;
  interval: Interval;
}): StrategyConfig =>
  buildRuntimeModeStrategyConfig({
    strategyConfig,
    env: 'PARITY',
    interval,
    makeOrders: true,
    recordRuntimeTrades: false,
  });

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const compactReplayAdditionalIndicators = (
  additionalIndicators: Signal['additionalIndicators'],
): Signal['additionalIndicators'] => {
  const additional = toRecord(additionalIndicators);
  if (!additional) {
    return undefined;
  }

  const compact: Record<string, unknown> = {};
  if (additional.executionSlippage != null) {
    compact.executionSlippage = additional.executionSlippage;
  }
  if (additional.marketContext != null) {
    compact.marketContext = additional.marketContext;
  }

  const baseContext = toRecord(additional.baseContext);
  const relative = toRecord(baseContext?.relative);
  const execution = toRecord(relative?.execution);
  if (execution) {
    compact.baseContext = {
      relative: {
        execution,
      },
    };
  }

  return Object.keys(compact).length
    ? (compact as Signal['additionalIndicators'])
    : undefined;
};

export const compactReplaySignal = (signal?: Signal): Signal | undefined => {
  if (!signal) {
    return undefined;
  }

  return {
    signalId: signal.signalId,
    strategy: signal.strategy,
    symbol: signal.symbol,
    interval: signal.interval,
    direction: signal.direction,
    timestamp: signal.timestamp,
    prices: signal.prices,
    indicators: {},
    figures: {},
    additionalIndicators: compactReplayAdditionalIndicators(
      signal.additionalIndicators,
    ),
    isConfigFromBacktest: signal.isConfigFromBacktest,
    ...(signal.orderStatus ? { orderStatus: signal.orderStatus } : {}),
    ...(signal.orderSkipReason
      ? { orderSkipReason: signal.orderSkipReason }
      : {}),
    ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
    ...(signal.ml ? { ml: signal.ml } : {}),
  };
};
