import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  BACKTEST_DELAY_RISK_LOOKBACK_CANDLES,
  BACKTEST_DELAY_RISK_MAX_BPS,
  BACKTEST_DELAY_RISK_MULTIPLIER,
  BACKTEST_EXPECTED_DELAY_MS,
  BACKTEST_MARKET_IMPACT_BPS,
  BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
} from '../constants';
import { intervalToMs } from './array';
import type { Interval } from '@tradejs/types';

export type ExecutionSlippageStage = 'entry' | 'exit';
export type ExecutionSlippageDirection = 'LONG' | 'SHORT';

export type ExecutionSlippageModelParams = {
  baseSlippageBps?: number | null;
  spreadBps?: number | null;
  spreadMultiplier?: number | null;
  marketImpactBps?: number | null;
  delayRiskBps?: number | null;
};

export type ExecutionSlippageBreakdown = {
  baseSlippageBps: number;
  spreadBps: number;
  spreadMultiplier: number;
  spreadSlippageBps: number;
  marketImpactBps: number;
  delayRiskBps: number;
  effectiveSlippageBps: number;
};

export type ExecutionDelayRiskParams = {
  closes?: unknown[] | null;
  candles?: unknown[] | null;
  intervalMs?: number | null;
  expectedDelayMs?: number | null;
  lookbackCandles?: number | null;
  multiplier?: number | null;
  maxBps?: number | null;
};

export type ApplyExecutionSlippageParams = ExecutionSlippageModelParams & {
  price: number;
  direction: ExecutionSlippageDirection;
  stage: ExecutionSlippageStage;
};

const toNonNegativeFiniteNumber = (
  value: number | null | undefined,
  fallback = 0,
) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;

const toFiniteNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;

const getMedian = (values: number[]) => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    const left = sorted[middle - 1];
    const right = sorted[middle];
    return left == null || right == null ? null : (left + right) / 2;
  }

  return sorted[middle] ?? null;
};

const extractCandleClose = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const record = toRecord(value);
  return toFiniteNumberOrNull(record?.close);
};

const extractCloseSeries = ({
  closes,
  candles,
}: Pick<ExecutionDelayRiskParams, 'closes' | 'candles'>) => {
  const source = Array.isArray(closes) && closes.length ? closes : candles;
  if (!Array.isArray(source)) {
    return [];
  }

  return source
    .map(extractCandleClose)
    .filter((value): value is number => value != null && value > 0);
};

const getSignalIntervalMs = (interval: unknown) => {
  if (typeof interval !== 'string') {
    return null;
  }

  try {
    return intervalToMs(interval as Interval);
  } catch {
    return null;
  }
};

const getSignalCandleSeries = (signal?: {
  interval?: unknown;
  indicators?: Record<string, unknown>;
}) => {
  const indicators = toRecord(signal?.indicators);
  if (!indicators) {
    return null;
  }

  const intervalKey = (() => {
    switch (signal?.interval) {
      case '15':
        return 'candles15m';
      case '60':
        return 'candles1h';
      case '240':
        return 'candles4h';
      case 'D':
        return 'candles1d';
      default:
        return null;
    }
  })();
  const keys = [
    intervalKey,
    'candles15m',
    'candles1h',
    'candles4h',
    'candles1d',
  ].filter((key): key is string => Boolean(key));

  for (const key of keys) {
    const value = indicators[key];
    if (Array.isArray(value) && value.length > 1) {
      return value;
    }
  }

  const candle = indicators.candle;
  const prevCandle = indicators.prevCandle;
  return prevCandle && candle ? [prevCandle, candle] : null;
};

const extractFreshTargetVenueSpreadBps = (
  targetVenue: Record<string, unknown> | null,
) => {
  if (!targetVenue) {
    return null;
  }

  if (targetVenue.stale === true || targetVenue.available === false) {
    return null;
  }

  return toFiniteNumberOrNull(targetVenue.spreadBps);
};

export const calculateEffectiveSlippageBps = ({
  baseSlippageBps = BACKTEST_BASE_SLIPPAGE_BPS,
  spreadBps,
  spreadMultiplier = BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
  marketImpactBps = BACKTEST_MARKET_IMPACT_BPS,
  delayRiskBps,
}: ExecutionSlippageModelParams = {}) => {
  const base = toNonNegativeFiniteNumber(baseSlippageBps);
  const spread = toNonNegativeFiniteNumber(spreadBps);
  const multiplier = toNonNegativeFiniteNumber(spreadMultiplier);
  const marketImpact = toNonNegativeFiniteNumber(marketImpactBps);
  const delayRisk = toNonNegativeFiniteNumber(delayRiskBps);

  return base + spread * multiplier + marketImpact + delayRisk;
};

export const calculateExecutionSlippageBreakdown = ({
  baseSlippageBps = BACKTEST_BASE_SLIPPAGE_BPS,
  spreadBps,
  spreadMultiplier = BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
  marketImpactBps = BACKTEST_MARKET_IMPACT_BPS,
  delayRiskBps,
}: ExecutionSlippageModelParams = {}): ExecutionSlippageBreakdown => {
  const base = toNonNegativeFiniteNumber(baseSlippageBps);
  const spread = toNonNegativeFiniteNumber(spreadBps);
  const multiplier = toNonNegativeFiniteNumber(spreadMultiplier);
  const spreadSlippage = spread * multiplier;
  const marketImpact = toNonNegativeFiniteNumber(marketImpactBps);
  const delayRisk = toNonNegativeFiniteNumber(delayRiskBps);

  return {
    baseSlippageBps: base,
    spreadBps: spread,
    spreadMultiplier: multiplier,
    spreadSlippageBps: spreadSlippage,
    marketImpactBps: marketImpact,
    delayRiskBps: delayRisk,
    effectiveSlippageBps: base + spreadSlippage + marketImpact + delayRisk,
  };
};

export const calculateDelayRiskBps = ({
  closes,
  candles,
  intervalMs,
  expectedDelayMs = BACKTEST_EXPECTED_DELAY_MS,
  lookbackCandles = BACKTEST_DELAY_RISK_LOOKBACK_CANDLES,
  multiplier = BACKTEST_DELAY_RISK_MULTIPLIER,
  maxBps = BACKTEST_DELAY_RISK_MAX_BPS,
}: ExecutionDelayRiskParams = {}) => {
  const normalizedLookback = Math.max(
    1,
    Math.trunc(toNonNegativeFiniteNumber(lookbackCandles, 1)),
  );
  const closeSeries = extractCloseSeries({ closes, candles }).slice(
    -(normalizedLookback + 1),
  );

  if (closeSeries.length < 2) {
    return null;
  }

  const moveBps: number[] = [];
  for (let index = 1; index < closeSeries.length; index += 1) {
    const previous = closeSeries[index - 1];
    const current = closeSeries[index];
    if (previous != null && current != null && previous > 0 && current > 0) {
      moveBps.push(Math.abs(current / previous - 1) * 10_000);
    }
  }

  const medianMoveBps = getMedian(moveBps);
  if (medianMoveBps == null) {
    return null;
  }

  const delayScale =
    typeof intervalMs === 'number' &&
    Number.isFinite(intervalMs) &&
    intervalMs > 0 &&
    typeof expectedDelayMs === 'number' &&
    Number.isFinite(expectedDelayMs) &&
    expectedDelayMs > 0
      ? Math.sqrt(expectedDelayMs / intervalMs)
      : 1;
  const rawDelayRisk =
    medianMoveBps * delayScale * toNonNegativeFiniteNumber(multiplier);
  const cappedDelayRisk = Math.min(
    rawDelayRisk,
    toNonNegativeFiniteNumber(maxBps, Number.POSITIVE_INFINITY),
  );

  return Number.isFinite(cappedDelayRisk) ? cappedDelayRisk : null;
};

export const slippageBpsToRate = (slippageBps: number) =>
  toNonNegativeFiniteNumber(slippageBps) / 10_000;

export const applyExecutionSlippage = ({
  price,
  direction,
  stage,
  ...modelParams
}: ApplyExecutionSlippageParams) => {
  const slippageRate = slippageBpsToRate(
    calculateExecutionSlippageBreakdown(modelParams).effectiveSlippageBps,
  );

  if (!slippageRate) {
    return price;
  }

  const sign =
    direction === 'LONG'
      ? stage === 'entry'
        ? 1
        : -1
      : stage === 'entry'
        ? -1
        : 1;

  return price * (1 + sign * slippageRate);
};

export const extractExecutionSpreadBps = (signal?: {
  additionalIndicators?: Record<string, unknown>;
}) => {
  const additionalIndicators = toRecord(signal?.additionalIndicators);
  const explicitSlippage = toRecord(additionalIndicators?.executionSlippage);
  const explicitSpread = toFiniteNumberOrNull(explicitSlippage?.spreadBps);
  if (explicitSpread != null) {
    return explicitSpread;
  }

  const marketContext = toRecord(additionalIndicators?.marketContext);
  const marketExecution = toRecord(marketContext?.execution);
  const marketTargetVenue = toRecord(marketExecution?.targetVenue);
  const marketTargetSpread =
    extractFreshTargetVenueSpreadBps(marketTargetVenue);
  if (marketTargetSpread != null) {
    return marketTargetSpread;
  }

  const baseContext = toRecord(additionalIndicators?.baseContext);
  const relative = toRecord(baseContext?.relative);
  const execution = toRecord(relative?.execution);
  const targetVenue = toRecord(execution?.targetVenue);
  return extractFreshTargetVenueSpreadBps(targetVenue);
};

export const extractExecutionMarketImpactBps = (signal?: {
  additionalIndicators?: Record<string, unknown>;
}) => {
  const additionalIndicators = toRecord(signal?.additionalIndicators);
  const explicitSlippage = toRecord(additionalIndicators?.executionSlippage);
  return toFiniteNumberOrNull(explicitSlippage?.marketImpactBps);
};

export const extractExecutionDelayRiskBps = (signal?: {
  interval?: unknown;
  indicators?: Record<string, unknown>;
  additionalIndicators?: Record<string, unknown>;
}) => {
  const additionalIndicators = toRecord(signal?.additionalIndicators);
  const explicitSlippage = toRecord(additionalIndicators?.executionSlippage);
  const explicitDelayRisk = toFiniteNumberOrNull(
    explicitSlippage?.delayRiskBps,
  );
  if (explicitDelayRisk != null) {
    return explicitDelayRisk;
  }

  return calculateDelayRiskBps({
    candles: getSignalCandleSeries(signal),
    intervalMs: getSignalIntervalMs(signal?.interval),
  });
};
