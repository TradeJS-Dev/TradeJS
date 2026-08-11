import { BACKTEST_EXECUTION_INTERVAL } from '@tradejs/core/constants';
import { intervalToMs } from '@tradejs/core/data';
import {
  calculateRiskRatio,
  resolveBacktestExecutionPrice,
} from '@tradejs/core/strategies';
import type {
  KlineChartData,
  KlineChartItem,
  StrategyConfig,
  StrategyDecision,
} from '@tradejs/types';

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;

export type BacktestExecutionCandleResolution = {
  candle?: KlineChartItem;
  btcCandle?: KlineChartItem;
  source: 'primary_timeframe' | 'lower_timeframe';
  requestedExecutionTimestamp?: number;
  executionInterval?: string;
  executionDelayMs?: number;
  primaryExecutionTimestamp?: number;
  skipReason?: string;
};

export const resolveBacktestEntryDelayBars = (value: unknown) => {
  if (value == null || value === '') {
    return 1;
  }
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
};

export const resolveBacktestExecutionIntervalForPrimary = (
  interval: unknown,
) => {
  const normalized = String(interval ?? '15');
  if (normalized === '15') {
    return BACKTEST_EXECUTION_INTERVAL;
  }
  if (normalized === '60') {
    return '15';
  }
  return null;
};

export const resolveBacktestExecutionDelayMs = (
  value: unknown,
  fallbackDelayMs: number,
) => {
  if (value == null || value === '') {
    return fallbackDelayMs;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.trunc(parsed))
    : fallbackDelayMs;
};

export const safeIntervalToMs = (interval: unknown) => {
  try {
    return intervalToMs(interval as any);
  } catch {
    return null;
  }
};

export const buildCandleByTimestamp = (candles?: KlineChartData) =>
  new Map(
    (candles ?? [])
      .filter((candle) => typeof candle?.timestamp === 'number')
      .map((candle) => [candle.timestamp, candle]),
  );

const buildBacktestExecutionOnlyCandle = (
  candle: KlineChartItem,
  executionPrice: number,
): KlineChartItem => ({
  ...candle,
  open: executionPrice,
  high: executionPrice,
  low: executionPrice,
  close: executionPrice,
  volume: 0,
  turnover: 0,
});

const resolveInvalidDelayedEntryReason = ({
  decision,
  executionPrice,
  takeProfitPrice,
  stopLossPrice,
  riskRatio,
}: {
  decision: EntryDecision;
  executionPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
}) => {
  if (
    !Number.isFinite(executionPrice) ||
    !Number.isFinite(takeProfitPrice) ||
    !Number.isFinite(stopLossPrice)
  ) {
    return 'BACKTEST_DELAYED_ENTRY_INVALID_PRICE';
  }

  if (decision.entryContext.direction === 'LONG') {
    if (executionPrice <= stopLossPrice) {
      return 'BACKTEST_DELAYED_ENTRY_BEYOND_STOP';
    }
    if (executionPrice >= takeProfitPrice) {
      return 'BACKTEST_DELAYED_ENTRY_BEYOND_TAKE_PROFIT';
    }
    return !Number.isFinite(riskRatio) || riskRatio <= 0
      ? 'BACKTEST_DELAYED_ENTRY_INVALID_PRICE'
      : null;
  }

  if (executionPrice >= stopLossPrice) {
    return 'BACKTEST_DELAYED_ENTRY_BEYOND_STOP';
  }
  if (executionPrice <= takeProfitPrice) {
    return 'BACKTEST_DELAYED_ENTRY_BEYOND_TAKE_PROFIT';
  }
  return !Number.isFinite(riskRatio) || riskRatio <= 0
    ? 'BACKTEST_DELAYED_ENTRY_INVALID_PRICE'
    : null;
};

export const applyBacktestDelayedEntryExecution = ({
  decision,
  execution,
  backtestPriceMode,
  delayBars,
}: {
  decision: EntryDecision;
  execution: BacktestExecutionCandleResolution;
  backtestPriceMode: StrategyConfig['BACKTEST_PRICE_MODE'];
  delayBars: number;
}) => {
  const { candle, btcCandle } = execution;
  const signalTimestamp =
    decision.signal?.timestamp ?? decision.entryContext.timestamp;
  const signalPrice =
    decision.signal?.prices.currentPrice ??
    decision.entryContext.prices.currentPrice;
  const skipReason =
    execution.skipReason ??
    (!candle || !btcCandle
      ? 'BACKTEST_LOWER_EXECUTION_CANDLE_MISSING'
      : undefined);

  if (skipReason || !candle || !btcCandle) {
    if (decision.signal) {
      decision.signal.additionalIndicators = {
        ...(decision.signal.additionalIndicators ?? {}),
        backtestExecution: {
          entryDelayBars: delayBars,
          priceMode: backtestPriceMode ?? 'open',
          signalTimestamp,
          signalPrice,
          executionSource: execution.source,
          ...(execution.executionInterval
            ? { executionInterval: execution.executionInterval }
            : {}),
          ...(execution.executionDelayMs != null
            ? { executionDelayMs: execution.executionDelayMs }
            : {}),
          ...(execution.primaryExecutionTimestamp != null
            ? { primaryExecutionTimestamp: execution.primaryExecutionTimestamp }
            : {}),
          ...(execution.requestedExecutionTimestamp != null
            ? {
                requestedExecutionTimestamp:
                  execution.requestedExecutionTimestamp,
              }
            : {}),
          skipReason,
        },
      };
      decision.signal.orderStatus = 'skipped';
      decision.signal.orderSkipReason = skipReason;
    }

    return {
      skipReason,
      executionCandle: null,
      btcExecutionCandle: null,
    };
  }

  const executionPrice = resolveBacktestExecutionPrice(
    candle,
    backtestPriceMode ?? 'open',
  );
  const executionTimestamp = candle.timestamp;
  const takeProfitPrice = decision.entryContext.prices.takeProfitPrice;
  const stopLossPrice = decision.orderPlan.stopLossPrice;
  const riskRatio = calculateRiskRatio({
    direction: decision.entryContext.direction,
    currentPrice: executionPrice,
    takeProfitPrice,
    stopLossPrice,
  });
  const invalidSkipReason = resolveInvalidDelayedEntryReason({
    decision,
    executionPrice,
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
  });

  decision.entryContext = {
    ...decision.entryContext,
    timestamp: executionTimestamp,
    prices: {
      ...decision.entryContext.prices,
      currentPrice: executionPrice,
      stopLossPrice,
      riskRatio,
    },
  };

  const executionResult = {
    skipReason: invalidSkipReason,
    executionCandle: buildBacktestExecutionOnlyCandle(candle, executionPrice),
    btcExecutionCandle: buildBacktestExecutionOnlyCandle(
      btcCandle,
      resolveBacktestExecutionPrice(btcCandle, backtestPriceMode ?? 'open'),
    ),
  };

  if (!decision.signal) {
    return executionResult;
  }

  decision.signal.prices = {
    ...decision.signal.prices,
    currentPrice: executionPrice,
    stopLossPrice,
    riskRatio,
  };
  decision.signal.additionalIndicators = {
    ...(decision.signal.additionalIndicators ?? {}),
    backtestExecution: {
      entryDelayBars: delayBars,
      priceMode: backtestPriceMode ?? 'open',
      signalTimestamp,
      signalPrice,
      executionTimestamp,
      executionPrice,
      executionSource: execution.source,
      ...(execution.executionInterval
        ? { executionInterval: execution.executionInterval }
        : {}),
      ...(execution.executionDelayMs != null
        ? { executionDelayMs: execution.executionDelayMs }
        : {}),
      ...(execution.primaryExecutionTimestamp != null
        ? { primaryExecutionTimestamp: execution.primaryExecutionTimestamp }
        : {}),
      ...(execution.requestedExecutionTimestamp != null
        ? { requestedExecutionTimestamp: execution.requestedExecutionTimestamp }
        : {}),
      ...(invalidSkipReason ? { skipReason: invalidSkipReason } : {}),
    },
  };

  if (invalidSkipReason) {
    decision.signal.orderStatus = 'skipped';
    decision.signal.orderSkipReason = invalidSkipReason;
  }

  return executionResult;
};
