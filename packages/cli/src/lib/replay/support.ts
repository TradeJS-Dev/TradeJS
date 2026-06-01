import chalk from 'chalk';
import { Interval, StrategyConfig } from '@tradejs/types';

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
export const REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS = 1;
export const REPLAY_RUNTIME_COMPARE_TOLERANCE_MS =
  REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS * 15 * 60 * 1000;

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
}): StrategyConfig => ({
  ...strategyConfig,
  ENV: 'PARITY',
  MAKE_ORDERS: true,
  INTERVAL: interval,
  RECORD_RUNTIME_TRADES: false,
});
