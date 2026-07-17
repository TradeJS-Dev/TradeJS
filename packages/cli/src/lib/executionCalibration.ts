import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  BACKTEST_MARKET_IMPACT_BPS,
  BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
} from '@tradejs/core/constants';
import { intervalToMs } from '@tradejs/core/data';
import { calculateDelayRiskBps } from '@tradejs/core/trade';
import type { Direction, Interval } from '@tradejs/types';

type JsonRecord = Record<string, unknown>;

export type ExecutionCalibrationSourcePaths = {
  runtimeEvidence?: string | null;
  replayEvidence?: string | null;
};

export type ExecutionCalibrationMetricSummary = {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
};

export type ExecutionCalibrationSample = {
  strategy: string | null;
  symbol: string | null;
  interval: string | null;
  direction: Direction | null;
  orderId: string | null;
  signalId: string | null;
  qty: number | null;
  signalTimestamp: number | null;
  signalCloseTimestamp: number | null;
  signalClosePrice: number | null;
  arrivalSnapshotTime: number | null;
  arrivalSource: string | null;
  arrivalMid: number | null;
  bid: number | null;
  ask: number | null;
  spreadBps: number | null;
  orderSubmitTime: number | null;
  orderAckTime: number | null;
  fillAvgPrice: number | null;
  fillSource: string | null;
  fillTime: number | null;
  telemetryQuality: 'full' | 'partial' | 'price_only' | 'none';
  fee: number | null;
  feeBps: number | null;
  arrivalSnapshotAgeMs: number | null;
  signalToSubmitMs: number | null;
  signalCloseToSubmitMs: number | null;
  submitToAckMs: number | null;
  submitToFillMs: number | null;
  orderAckToFillMs: number | null;
  signalToFillMs: number | null;
  signalToArrivalAdverseBps: number | null;
  arrivalToFillAdverseBps: number | null;
  signalToFillAdverseBps: number | null;
  currentDelayRiskBps: number | null;
  rawConfiguredDelayRiskBps: number | null;
  rawObservedDelayRiskBps: number | null;
  currentModelEntrySlippageBps: number | null;
  residualVsCurrentModelBps: number | null;
  replayEntryResidualBps: number | null;
};

export type ExecutionCalibrationCountBreakdown = Record<string, number>;

export type ExecutionCalibrationGroupSummary = {
  trades: number;
  fullTelemetryTrades: number;
  replayMatchedTrades: number;
  telemetryQuality: ExecutionCalibrationCountBreakdown;
  fillSource: ExecutionCalibrationCountBreakdown;
  arrivalSource: ExecutionCalibrationCountBreakdown;
  signalToArrivalAdverseBps: ExecutionCalibrationMetricSummary;
  arrivalToFillAdverseBps: ExecutionCalibrationMetricSummary;
  signalToFillAdverseBps: ExecutionCalibrationMetricSummary;
  residualVsCurrentModelBps: ExecutionCalibrationMetricSummary;
  replayEntryResidualBps: ExecutionCalibrationMetricSummary;
  spreadBps: ExecutionCalibrationMetricSummary;
  feeBps: ExecutionCalibrationMetricSummary;
  arrivalSnapshotAgeMs: ExecutionCalibrationMetricSummary;
  signalToSubmitMs: ExecutionCalibrationMetricSummary;
  signalCloseToSubmitMs: ExecutionCalibrationMetricSummary;
  submitToAckMs: ExecutionCalibrationMetricSummary;
  submitToFillMs: ExecutionCalibrationMetricSummary;
  orderAckToFillMs: ExecutionCalibrationMetricSummary;
  currentDelayRiskBps: ExecutionCalibrationMetricSummary;
  rawConfiguredDelayRiskBps: ExecutionCalibrationMetricSummary;
  rawObservedDelayRiskBps: ExecutionCalibrationMetricSummary;
};

export type ExecutionCalibrationRecommendation = {
  confidence: 'none' | 'low' | 'medium' | 'high';
  baseSlippageBps: number | null;
  spreadMultiplier: number | null;
  delayRiskMultiplier: number | null;
  delayRiskMaxBps: number | null;
  expectedDelayMs: number | null;
  notes: string[];
};

export type ExecutionCalibrationReport = {
  reportType: 'execution-calibration';
  generatedAt: number;
  sources: ExecutionCalibrationSourcePaths;
  currentModel: {
    baseSlippageBps: number;
    spreadMultiplier: number;
    marketImpactBps: number;
  };
  counts: {
    runtimeTrades: number;
    telemetryTrades: number;
    fullTelemetryTrades: number;
    replayMatched: number;
    replayMatchedRuntimeTrades: number;
    replayOnlyMatches: number;
  };
  summary: {
    all: ExecutionCalibrationGroupSummary;
    byStrategy: Record<string, ExecutionCalibrationGroupSummary>;
    bySymbol: Record<string, ExecutionCalibrationGroupSummary>;
    byInterval: Record<string, ExecutionCalibrationGroupSummary>;
    byTelemetryQuality: Record<string, ExecutionCalibrationGroupSummary>;
    byFillSource: Record<string, ExecutionCalibrationGroupSummary>;
    byLatencyBucket: Record<string, ExecutionCalibrationGroupSummary>;
    bySpreadBucket: Record<string, ExecutionCalibrationGroupSummary>;
  };
  recommendation: ExecutionCalibrationRecommendation;
  samples: ExecutionCalibrationSample[];
  replayOnlySamples: ExecutionCalibrationSample[];
};

type RuntimeTradeRow = {
  trade: JsonRecord;
  signal: JsonRecord | null;
};

type ReplayMatch = {
  orderId: string | null;
  orderLinkId: string | null;
  signalId: string | null;
  strategy: string | null;
  symbol: string | null;
  direction: Direction | null;
  backtestPrice: number | null;
  runtimePrice: number | null;
};

const roundMetric = (value: number | null | undefined, decimals = 6) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Number(value.toFixed(decimals))
    : null;

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const finiteString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const finiteDirection = (value: unknown): Direction | null =>
  value === 'LONG' || value === 'SHORT' ? value : null;

const metricValues = (
  samples: ExecutionCalibrationSample[],
  key: keyof ExecutionCalibrationSample,
) =>
  samples
    .map((sample) => sample[key])
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );

const quantile = (values: number[], probability: number) => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];

  if (lower == null || upper == null) {
    return null;
  }

  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (index - lowerIndex);
};

const summarizeNumbers = (
  values: number[],
): ExecutionCalibrationMetricSummary => {
  const finite = values.filter((value) => Number.isFinite(value));

  if (!finite.length) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
      p50: null,
      p75: null,
      p90: null,
      p95: null,
    };
  }

  const total = finite.reduce((sum, value) => sum + value, 0);

  return {
    count: finite.length,
    min: roundMetric(Math.min(...finite)),
    max: roundMetric(Math.max(...finite)),
    avg: roundMetric(total / finite.length),
    p50: roundMetric(quantile(finite, 0.5)),
    p75: roundMetric(quantile(finite, 0.75)),
    p90: roundMetric(quantile(finite, 0.9)),
    p95: roundMetric(quantile(finite, 0.95)),
  };
};

const getIntervalMs = (interval: string | null) => {
  if (!interval) {
    return null;
  }

  try {
    return intervalToMs(interval as Interval);
  } catch {
    return null;
  }
};

const getSignalKey = ({
  strategy,
  symbol,
  timestamp,
}: {
  strategy: string | null;
  symbol: string | null;
  timestamp: number | null;
}) =>
  strategy && symbol && timestamp != null
    ? `${strategy}:${symbol}:${timestamp}`
    : null;

const addSignalToMap = (
  signalsById: Map<string, JsonRecord>,
  signalsByShape: Map<string, JsonRecord>,
  signal: JsonRecord | null,
) => {
  if (!signal) {
    return;
  }

  const signalId = finiteString(signal.signalId);
  if (signalId) {
    signalsById.set(signalId, signal);
  }

  const shapeKey = getSignalKey({
    strategy: finiteString(signal.strategy),
    symbol: finiteString(signal.symbol),
    timestamp: finiteNumber(signal.timestamp),
  });
  if (shapeKey) {
    signalsByShape.set(shapeKey, signal);
  }
};

const getRuntimePayload = ({
  runtimeArtifact,
  replayEvidenceArtifact,
}: {
  runtimeArtifact?: unknown;
  replayEvidenceArtifact?: unknown;
}) => {
  const explicitRuntime = asRecord(runtimeArtifact);
  if (explicitRuntime) {
    return asRecord(explicitRuntime.runtime) ?? explicitRuntime;
  }

  const replayEvidence = asRecord(replayEvidenceArtifact);
  return asRecord(replayEvidence?.runtime);
};

const extractRuntimeTradeRows = (
  runtimePayload: JsonRecord | null,
): RuntimeTradeRow[] => {
  if (!runtimePayload) {
    return [];
  }

  const signalsById = new Map<string, JsonRecord>();
  const signalsByShape = new Map<string, JsonRecord>();

  for (const signalRow of asArray(runtimePayload.signals)) {
    const record = asRecord(signalRow);
    addSignalToMap(
      signalsById,
      signalsByShape,
      asRecord(record?.signal) ?? record,
    );
  }

  return asArray(runtimePayload.trades)
    .map((row): RuntimeTradeRow | null => {
      const record = asRecord(row);
      if (!record) {
        return null;
      }

      const redisValues = asRecord(record.redisValues);
      const trade =
        asRecord(record.trade) ?? asRecord(redisValues?.trade) ?? record;
      const signalId = finiteString(trade.signalId);
      const shapeKey = getSignalKey({
        strategy: finiteString(trade.strategy),
        symbol: finiteString(trade.symbol),
        timestamp: finiteNumber(trade.signalTimestamp ?? trade.entryTimestamp),
      });
      const signal =
        asRecord(redisValues?.signal) ??
        (signalId ? signalsById.get(signalId) ?? null : null) ??
        (shapeKey ? signalsByShape.get(shapeKey) ?? null : null);

      return {
        trade,
        signal,
      };
    })
    .filter((row): row is RuntimeTradeRow => row != null);
};

const normalizeReplayMatch = (value: unknown): ReplayMatch | null => {
  const item = asRecord(value);
  if (!item) {
    return null;
  }

  const runtime = asRecord(item.runtime);
  const backtest = asRecord(item.backtest);

  return {
    orderId: finiteString(
      item.orderId ?? runtime?.orderId ?? backtest?.orderId,
    ),
    orderLinkId: finiteString(item.orderLinkId ?? runtime?.orderLinkId),
    signalId: finiteString(item.signalId ?? backtest?.signalId),
    strategy: finiteString(
      item.strategy ?? backtest?.strategy ?? runtime?.inferredStrategy,
    ),
    symbol: finiteString(item.symbol ?? backtest?.symbol ?? runtime?.symbol),
    direction: finiteDirection(
      item.direction ?? backtest?.direction ?? runtime?.direction,
    ),
    backtestPrice: finiteNumber(item.backtestPrice ?? backtest?.price),
    runtimePrice: finiteNumber(item.runtimePrice ?? runtime?.price),
  };
};

const extractReplayMatches = (
  replayEvidenceArtifact?: unknown,
): ReplayMatch[] => {
  const artifact = asRecord(replayEvidenceArtifact);
  if (!artifact) {
    return [];
  }

  const replay = asRecord(artifact.replay) ?? artifact;
  const runtimeComparison = asRecord(replay.runtimeComparison);
  const details = asRecord(runtimeComparison?.details);
  const matched = asArray(runtimeComparison?.matched).length
    ? asArray(runtimeComparison?.matched)
    : asArray(details?.matched);

  return matched
    .map(normalizeReplayMatch)
    .filter((match): match is ReplayMatch => match != null);
};

const buildReplayMatchMaps = (matches: ReplayMatch[]) => {
  const maps = {
    byOrderId: new Map<string, ReplayMatch>(),
    bySignalId: new Map<string, ReplayMatch>(),
  };

  for (const match of matches) {
    for (const orderId of [match.orderLinkId, match.orderId]) {
      if (orderId) {
        maps.byOrderId.set(orderId, match);
      }
    }
    if (match.signalId) {
      maps.bySignalId.set(match.signalId, match);
    }
  }

  return maps;
};

const getSignalCandles = (
  signal: JsonRecord | null,
  interval: string | null,
) => {
  const indicators = asRecord(signal?.indicators);
  if (!indicators) {
    return null;
  }

  const intervalKey = (() => {
    switch (interval) {
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
    'candles',
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

const adverseEntryBps = ({
  direction,
  expectedPrice,
  actualPrice,
}: {
  direction: Direction | null;
  expectedPrice: number | null;
  actualPrice: number | null;
}) => {
  if (
    !direction ||
    expectedPrice == null ||
    actualPrice == null ||
    expectedPrice <= 0 ||
    actualPrice <= 0
  ) {
    return null;
  }

  const value =
    direction === 'LONG'
      ? (actualPrice / expectedPrice - 1) * 10_000
      : (expectedPrice / actualPrice - 1) * 10_000;

  return roundMetric(value);
};

const feeBps = ({
  fee,
  fillAvgPrice,
  qty,
}: {
  fee: number | null;
  fillAvgPrice: number | null;
  qty: number | null;
}) => {
  const notional =
    fillAvgPrice != null && qty != null && fillAvgPrice > 0 && qty > 0
      ? fillAvgPrice * qty
      : null;

  return fee != null && notional != null && notional > 0
    ? roundMetric((fee / notional) * 10_000)
    : null;
};

const latencyDelta = (end: number | null, start: number | null) =>
  end != null && start != null ? roundMetric(end - start, 3) : null;

const resolveTelemetryQuality = ({
  signalClosePrice,
  arrivalMid,
  orderSubmitTime,
  orderAckTime,
  fillAvgPrice,
  fillTime,
}: Pick<
  ExecutionCalibrationSample,
  | 'signalClosePrice'
  | 'arrivalMid'
  | 'orderSubmitTime'
  | 'orderAckTime'
  | 'fillAvgPrice'
  | 'fillTime'
>): ExecutionCalibrationSample['telemetryQuality'] => {
  if (
    signalClosePrice != null &&
    arrivalMid != null &&
    orderSubmitTime != null &&
    orderAckTime != null &&
    fillAvgPrice != null &&
    fillTime != null
  ) {
    return 'full';
  }

  if (fillAvgPrice != null && (arrivalMid != null || orderSubmitTime != null)) {
    return 'partial';
  }

  if (fillAvgPrice != null) {
    return 'price_only';
  }

  return 'none';
};

const finiteTelemetryQuality = (
  value: unknown,
): ExecutionCalibrationSample['telemetryQuality'] | null => {
  const raw = finiteString(value);
  return raw === 'full' ||
    raw === 'partial' ||
    raw === 'price_only' ||
    raw === 'none'
    ? raw
    : null;
};

const countBy = (
  samples: ExecutionCalibrationSample[],
  keyGetter: (sample: ExecutionCalibrationSample) => string | null,
): ExecutionCalibrationCountBreakdown => {
  const counts = new Map<string, number>();

  for (const sample of samples) {
    const key = keyGetter(sample) ?? 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
};

const toLatencyBucket = (sample: ExecutionCalibrationSample) => {
  const latencyMs = sample.signalCloseToSubmitMs ?? sample.signalToSubmitMs;
  if (latencyMs == null || !Number.isFinite(latencyMs)) return 'unknown';
  if (latencyMs <= 1_000) return '0-1s';
  if (latencyMs <= 5_000) return '1-5s';
  if (latencyMs <= 30_000) return '5-30s';
  if (latencyMs <= 120_000) return '30-120s';
  return '120s+';
};

const toSpreadBucket = (sample: ExecutionCalibrationSample) => {
  const spreadBps = sample.spreadBps;
  if (spreadBps == null || !Number.isFinite(spreadBps)) return 'unknown';
  if (spreadBps <= 5) return '0-5bps';
  if (spreadBps <= 20) return '5-20bps';
  if (spreadBps <= 50) return '20-50bps';
  return '50bps+';
};

const buildSample = ({
  row,
  match,
}: {
  row: RuntimeTradeRow;
  match: ReplayMatch | null;
}): ExecutionCalibrationSample => {
  const { trade, signal } = row;
  const strategy = finiteString(trade.strategy ?? signal?.strategy);
  const symbol = finiteString(trade.symbol ?? signal?.symbol);
  const interval = finiteString(trade.interval ?? signal?.interval);
  const direction = finiteDirection(trade.direction ?? signal?.direction);
  const orderId = finiteString(trade.orderId);
  const signalId = finiteString(trade.signalId ?? signal?.signalId);
  const qty = finiteNumber(trade.qty);
  const signalTimestamp = finiteNumber(
    trade.signalTimestamp ?? signal?.timestamp,
  );
  const intervalMs = getIntervalMs(interval);
  const signalCloseTimestamp =
    signalTimestamp != null && intervalMs != null
      ? signalTimestamp + intervalMs
      : signalTimestamp;
  const signalClosePrice = finiteNumber(trade.signalClosePrice);
  const arrivalSnapshotTime = finiteNumber(trade.arrivalSnapshotTime);
  const arrivalSource = finiteString(trade.arrivalSource);
  const arrivalMid = finiteNumber(trade.arrivalMid);
  const bid = finiteNumber(trade.bid);
  const ask = finiteNumber(trade.ask);
  const spreadBps = finiteNumber(trade.spreadBps);
  const orderSubmitTime = finiteNumber(trade.orderSubmitTime);
  const orderAckTime = finiteNumber(trade.orderAckTime);
  const fillAvgPrice = finiteNumber(trade.fillAvgPrice);
  const fillSource = finiteString(trade.fillSource);
  const fillTime = finiteNumber(trade.fillTime);
  const telemetryQuality =
    finiteTelemetryQuality(trade.telemetryQuality) ??
    resolveTelemetryQuality({
      signalClosePrice,
      arrivalMid,
      orderSubmitTime,
      orderAckTime,
      fillAvgPrice,
      fillTime,
    });
  const fee = finiteNumber(trade.fee ?? trade.openFee);
  const arrivalSnapshotAgeMs = latencyDelta(
    orderSubmitTime,
    arrivalSnapshotTime,
  );
  const signalToSubmitMs = latencyDelta(orderSubmitTime, signalTimestamp);
  const signalCloseToSubmitMs = latencyDelta(
    orderSubmitTime,
    signalCloseTimestamp,
  );
  const submitToAckMs = latencyDelta(orderAckTime, orderSubmitTime);
  const submitToFillMs = latencyDelta(fillTime, orderSubmitTime);
  const orderAckToFillMs = latencyDelta(fillTime, orderAckTime);
  const signalToFillMs = latencyDelta(fillTime, signalTimestamp);
  const observedDelayMs =
    signalCloseToSubmitMs != null && signalCloseToSubmitMs >= 0
      ? signalCloseToSubmitMs
      : signalToSubmitMs != null && signalToSubmitMs >= 0
        ? signalToSubmitMs
        : null;
  const candles = getSignalCandles(signal, interval);
  const currentDelayRiskBps = roundMetric(
    calculateDelayRiskBps({
      candles,
      intervalMs,
    }),
  );
  const rawConfiguredDelayRiskBps = roundMetric(
    calculateDelayRiskBps({
      candles,
      intervalMs,
      multiplier: 1,
      maxBps: Number.POSITIVE_INFINITY,
    }),
  );
  const rawObservedDelayRiskBps = roundMetric(
    calculateDelayRiskBps({
      candles,
      intervalMs,
      expectedDelayMs: observedDelayMs,
      multiplier: 1,
      maxBps: Number.POSITIVE_INFINITY,
    }),
  );
  const signalToArrivalAdverseBps = adverseEntryBps({
    direction,
    expectedPrice: signalClosePrice,
    actualPrice: arrivalMid,
  });
  const arrivalToFillAdverseBps = adverseEntryBps({
    direction,
    expectedPrice: arrivalMid,
    actualPrice: fillAvgPrice,
  });
  const signalToFillAdverseBps = adverseEntryBps({
    direction,
    expectedPrice: signalClosePrice,
    actualPrice: fillAvgPrice,
  });
  const currentModelEntrySlippageBps =
    signalToFillAdverseBps != null
      ? roundMetric(
          BACKTEST_BASE_SLIPPAGE_BPS +
            (spreadBps ?? 0) * BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER +
            BACKTEST_MARKET_IMPACT_BPS +
            (currentDelayRiskBps ?? 0),
        )
      : null;
  const residualVsCurrentModelBps =
    signalToFillAdverseBps != null && currentModelEntrySlippageBps != null
      ? roundMetric(signalToFillAdverseBps - currentModelEntrySlippageBps)
      : null;

  return {
    strategy,
    symbol,
    interval,
    direction,
    orderId,
    signalId,
    qty,
    signalTimestamp,
    signalCloseTimestamp,
    signalClosePrice,
    arrivalSnapshotTime,
    arrivalSource,
    arrivalMid,
    bid,
    ask,
    spreadBps,
    orderSubmitTime,
    orderAckTime,
    fillAvgPrice,
    fillSource,
    fillTime,
    telemetryQuality,
    fee,
    feeBps: feeBps({ fee, fillAvgPrice, qty }),
    arrivalSnapshotAgeMs,
    signalToSubmitMs,
    signalCloseToSubmitMs,
    submitToAckMs,
    submitToFillMs,
    orderAckToFillMs,
    signalToFillMs,
    signalToArrivalAdverseBps,
    arrivalToFillAdverseBps,
    signalToFillAdverseBps,
    currentDelayRiskBps,
    rawConfiguredDelayRiskBps,
    rawObservedDelayRiskBps,
    currentModelEntrySlippageBps,
    residualVsCurrentModelBps,
    replayEntryResidualBps: adverseEntryBps({
      direction: direction ?? match?.direction ?? null,
      expectedPrice: match?.backtestPrice ?? null,
      actualPrice: match?.runtimePrice ?? null,
    }),
  };
};

const buildReplayOnlySample = (
  match: ReplayMatch,
): ExecutionCalibrationSample => ({
  strategy: match.strategy,
  symbol: match.symbol,
  interval: null,
  direction: match.direction,
  orderId: match.orderLinkId ?? match.orderId,
  signalId: match.signalId,
  qty: null,
  signalTimestamp: null,
  signalCloseTimestamp: null,
  signalClosePrice: null,
  arrivalSnapshotTime: null,
  arrivalSource: null,
  arrivalMid: null,
  bid: null,
  ask: null,
  spreadBps: null,
  orderSubmitTime: null,
  orderAckTime: null,
  fillAvgPrice: match.runtimePrice,
  fillSource: 'replay_runtime_price',
  fillTime: null,
  telemetryQuality: match.runtimePrice != null ? 'price_only' : 'none',
  fee: null,
  feeBps: null,
  arrivalSnapshotAgeMs: null,
  signalToSubmitMs: null,
  signalCloseToSubmitMs: null,
  submitToAckMs: null,
  submitToFillMs: null,
  orderAckToFillMs: null,
  signalToFillMs: null,
  signalToArrivalAdverseBps: null,
  arrivalToFillAdverseBps: null,
  signalToFillAdverseBps: null,
  currentDelayRiskBps: null,
  rawConfiguredDelayRiskBps: null,
  rawObservedDelayRiskBps: null,
  currentModelEntrySlippageBps: null,
  residualVsCurrentModelBps: null,
  replayEntryResidualBps: adverseEntryBps({
    direction: match.direction,
    expectedPrice: match.backtestPrice,
    actualPrice: match.runtimePrice,
  }),
});

const hasTelemetry = (sample: ExecutionCalibrationSample) =>
  sample.signalClosePrice != null ||
  sample.arrivalMid != null ||
  sample.orderSubmitTime != null ||
  sample.fillAvgPrice != null ||
  sample.fillTime != null ||
  sample.fee != null;

const hasFullTelemetry = (sample: ExecutionCalibrationSample) =>
  sample.signalClosePrice != null &&
  sample.arrivalMid != null &&
  sample.orderSubmitTime != null &&
  sample.orderAckTime != null &&
  sample.fillAvgPrice != null &&
  sample.fillTime != null;

const buildGroupSummary = (
  samples: ExecutionCalibrationSample[],
): ExecutionCalibrationGroupSummary => ({
  trades: samples.length,
  fullTelemetryTrades: samples.filter(hasFullTelemetry).length,
  replayMatchedTrades: metricValues(samples, 'replayEntryResidualBps').length,
  telemetryQuality: countBy(samples, (sample) => sample.telemetryQuality),
  fillSource: countBy(samples, (sample) => sample.fillSource),
  arrivalSource: countBy(samples, (sample) => sample.arrivalSource),
  signalToArrivalAdverseBps: summarizeNumbers(
    metricValues(samples, 'signalToArrivalAdverseBps'),
  ),
  arrivalToFillAdverseBps: summarizeNumbers(
    metricValues(samples, 'arrivalToFillAdverseBps'),
  ),
  signalToFillAdverseBps: summarizeNumbers(
    metricValues(samples, 'signalToFillAdverseBps'),
  ),
  residualVsCurrentModelBps: summarizeNumbers(
    metricValues(samples, 'residualVsCurrentModelBps'),
  ),
  replayEntryResidualBps: summarizeNumbers(
    metricValues(samples, 'replayEntryResidualBps'),
  ),
  spreadBps: summarizeNumbers(metricValues(samples, 'spreadBps')),
  feeBps: summarizeNumbers(metricValues(samples, 'feeBps')),
  arrivalSnapshotAgeMs: summarizeNumbers(
    metricValues(samples, 'arrivalSnapshotAgeMs'),
  ),
  signalToSubmitMs: summarizeNumbers(metricValues(samples, 'signalToSubmitMs')),
  signalCloseToSubmitMs: summarizeNumbers(
    metricValues(samples, 'signalCloseToSubmitMs'),
  ),
  submitToAckMs: summarizeNumbers(metricValues(samples, 'submitToAckMs')),
  submitToFillMs: summarizeNumbers(metricValues(samples, 'submitToFillMs')),
  orderAckToFillMs: summarizeNumbers(metricValues(samples, 'orderAckToFillMs')),
  currentDelayRiskBps: summarizeNumbers(
    metricValues(samples, 'currentDelayRiskBps'),
  ),
  rawConfiguredDelayRiskBps: summarizeNumbers(
    metricValues(samples, 'rawConfiguredDelayRiskBps'),
  ),
  rawObservedDelayRiskBps: summarizeNumbers(
    metricValues(samples, 'rawObservedDelayRiskBps'),
  ),
});

const groupSamples = (
  samples: ExecutionCalibrationSample[],
  keyGetter: (sample: ExecutionCalibrationSample) => string | null,
) => {
  const groups = new Map<string, ExecutionCalibrationSample[]>();

  for (const sample of samples) {
    const key = keyGetter(sample);
    if (!key) {
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }

  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, group]) => [key, buildGroupSummary(group)]),
  );
};

const positiveMetricValues = (
  samples: ExecutionCalibrationSample[],
  key: keyof ExecutionCalibrationSample,
) => metricValues(samples, key).filter((value) => value > 0);

const buildRecommendation = (
  samples: ExecutionCalibrationSample[],
): ExecutionCalibrationRecommendation => {
  const fullTelemetrySamples = samples.filter(hasFullTelemetry);
  const notes: string[] = [];

  if (!fullTelemetrySamples.length) {
    return {
      confidence: 'none',
      baseSlippageBps: null,
      spreadMultiplier: null,
      delayRiskMultiplier: null,
      delayRiskMaxBps: null,
      expectedDelayMs: null,
      notes: [
        'No full live execution telemetry was found. Use a newer runtime debug artifact collected after telemetry persistence was enabled.',
        'Replay residuals can still diagnose model drift, but they are not enough to calibrate signal-to-arrival and arrival-to-fill components separately.',
      ],
    };
  }

  if (fullTelemetrySamples.length < 20) {
    notes.push(
      'Sample is small; treat recommendations as diagnostic until at least 20-50 live fills are available.',
    );
  }

  const spreadRatios = fullTelemetrySamples
    .map((sample) => {
      if (
        sample.arrivalToFillAdverseBps == null ||
        sample.spreadBps == null ||
        sample.spreadBps <= 0
      ) {
        return null;
      }
      return Math.max(0, sample.arrivalToFillAdverseBps) / sample.spreadBps;
    })
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  const spreadMultiplier = roundMetric(quantile(spreadRatios, 0.75), 4);
  const baseResiduals = fullTelemetrySamples
    .map((sample) => {
      if (sample.arrivalToFillAdverseBps == null) {
        return null;
      }
      return Math.max(
        0,
        sample.arrivalToFillAdverseBps -
          (sample.spreadBps ?? 0) *
            (spreadMultiplier ?? BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER),
      );
    })
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  const closeDelayMs = positiveMetricValues(
    fullTelemetrySamples,
    'signalCloseToSubmitMs',
  );
  const fallbackDelayMs = positiveMetricValues(
    fullTelemetrySamples,
    'signalToSubmitMs',
  );

  if (!spreadRatios.length) {
    notes.push(
      'Spread multiplier could not be calibrated because spreadBps or arrival-to-fill telemetry is missing.',
    );
  }
  notes.push(
    'Delay risk bps is disabled; signal-to-arrival latency is modeled by next-bar-open backtest fills.',
  );

  return {
    confidence:
      fullTelemetrySamples.length >= 50
        ? 'high'
        : fullTelemetrySamples.length >= 20
          ? 'medium'
          : 'low',
    baseSlippageBps: roundMetric(quantile(baseResiduals, 0.75), 2),
    spreadMultiplier,
    delayRiskMultiplier: null,
    delayRiskMaxBps: null,
    expectedDelayMs: roundMetric(
      quantile(closeDelayMs.length ? closeDelayMs : fallbackDelayMs, 0.5),
      0,
    ),
    notes,
  };
};

export const buildExecutionCalibrationReport = ({
  runtimeArtifact,
  replayEvidenceArtifact,
  sourcePaths = {},
  nowMs = Date.now(),
}: {
  runtimeArtifact?: unknown;
  replayEvidenceArtifact?: unknown;
  sourcePaths?: ExecutionCalibrationSourcePaths;
  nowMs?: number;
}): ExecutionCalibrationReport => {
  const runtimePayload = getRuntimePayload({
    runtimeArtifact,
    replayEvidenceArtifact,
  });
  const runtimeRows = extractRuntimeTradeRows(runtimePayload);
  const replayMatches = extractReplayMatches(replayEvidenceArtifact);
  const replayMaps = buildReplayMatchMaps(replayMatches);
  const usedReplayMatches = new Set<ReplayMatch>();
  const samples = runtimeRows.map((row) => {
    const orderId = finiteString(row.trade.orderId);
    const signalId = finiteString(row.trade.signalId);
    const match =
      (orderId ? replayMaps.byOrderId.get(orderId) ?? null : null) ??
      (signalId ? replayMaps.bySignalId.get(signalId) ?? null : null);

    if (match) {
      usedReplayMatches.add(match);
    }

    return buildSample({ row, match });
  });
  const replayOnlySamples = replayMatches
    .filter((match) => !usedReplayMatches.has(match))
    .map(buildReplayOnlySample);

  return {
    reportType: 'execution-calibration',
    generatedAt: nowMs,
    sources: sourcePaths,
    currentModel: {
      baseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
      spreadMultiplier: BACKTEST_SPREAD_SLIPPAGE_MULTIPLIER,
      marketImpactBps: BACKTEST_MARKET_IMPACT_BPS,
    },
    counts: {
      runtimeTrades: runtimeRows.length,
      telemetryTrades: samples.filter(hasTelemetry).length,
      fullTelemetryTrades: samples.filter(hasFullTelemetry).length,
      replayMatched: replayMatches.length,
      replayMatchedRuntimeTrades: usedReplayMatches.size,
      replayOnlyMatches: replayOnlySamples.length,
    },
    summary: {
      all: buildGroupSummary([...samples, ...replayOnlySamples]),
      byStrategy: groupSamples(
        [...samples, ...replayOnlySamples],
        (sample) => sample.strategy,
      ),
      bySymbol: groupSamples(samples, (sample) => sample.symbol),
      byInterval: groupSamples(samples, (sample) => sample.interval),
      byTelemetryQuality: groupSamples(
        [...samples, ...replayOnlySamples],
        (sample) => sample.telemetryQuality,
      ),
      byFillSource: groupSamples(
        [...samples, ...replayOnlySamples],
        (sample) => sample.fillSource,
      ),
      byLatencyBucket: groupSamples(samples, toLatencyBucket),
      bySpreadBucket: groupSamples(samples, toSpreadBucket),
    },
    recommendation: buildRecommendation(samples),
    samples,
    replayOnlySamples,
  };
};
