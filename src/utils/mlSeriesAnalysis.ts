export type MlSeriesAnalysisCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};

type MlSeriesAnalysisInput = {
  candles: MlSeriesAnalysisCandle[];
  benchmarkCandles?: MlSeriesAnalysisCandle[];
  indicators?: {
    atrPct?: number[];
    price1hPcnt?: number[];
    price24hPcnt?: number[];
    macdHistogram?: number[];
    maFast?: number[];
    maSlow?: number[];
  };
};

export type MlSeriesAnalysisSummary = Record<string, number>;

const toFinite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const safeDiv = (num: number, denom: number): number => {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0) return 0;
  return num / denom;
};

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const mean = (values: number[]): number => {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
};

const std = (values: number[]): number => {
  if (!values.length) return 0;
  const valuesMean = mean(values);
  const variance =
    values.reduce((acc, value) => acc + (value - valuesMean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
};

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const percentileRank = (values: number[], target: number): number => {
  if (!values.length || !Number.isFinite(target)) return 0.5;
  let less = 0;
  let equal = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < target) less += 1;
    else if (value === target) equal += 1;
  }
  return clamp((less + equal * 0.5) / values.length, 0, 1);
};

const linearSlope = (values: number[]): number => {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - xMean;
    cov += dx * (values[i] - yMean);
    varX += dx * dx;
  }
  return varX === 0 ? 0 : cov / varX;
};

const simpleReturns = (values: number[]): number[] => {
  if (values.length < 2) return [];
  const result: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    result.push(clamp(safeDiv(values[i], values[i - 1]) - 1, -5, 5));
  }
  return result;
};

const sign = (value: number): number => {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
};

const normalizeCandle = (
  candle?: Partial<MlSeriesAnalysisCandle>,
): MlSeriesAnalysisCandle => ({
  open: toFinite(Number(candle?.open ?? 0), 0),
  high: toFinite(Number(candle?.high ?? 0), 0),
  low: toFinite(Number(candle?.low ?? 0), 0),
  close: toFinite(Number(candle?.close ?? 0), 0),
  volume: toFinite(Number(candle?.volume ?? 0), 0),
  timestamp: toFinite(Number(candle?.timestamp ?? 0), 0),
});

const analyzeNumericSeries = (values: number[]): MlSeriesAnalysisSummary => {
  const clean = values.map((value) => toFinite(value, 0));
  const last = clean[clean.length - 1] ?? 0;
  const valuesMean = mean(clean);
  const valuesStd = std(clean);
  const slope = linearSlope(clean);
  const zLast = valuesStd > 0 ? (last - valuesMean) / valuesStd : 0;

  return {
    LAST: last,
    MEAN: valuesMean,
    STD: valuesStd,
    SLOPE: slope,
    SLOPE_NORM: Math.tanh(safeDiv(slope, Math.abs(valuesMean) + 1e-9)),
    Z_LAST: clamp(zLast, -8, 8),
    RANK_LAST: percentileRank(clean.length ? clean : [0], last),
  };
};

const candleCoreSummary = (
  rawCandles: MlSeriesAnalysisCandle[],
): MlSeriesAnalysisSummary => {
  const candles = rawCandles.map((candle) => normalizeCandle(candle));
  if (!candles.length) {
    return {
      CLOSE_NET_RET: 0,
      CLOSE_SLOPE_NORM: 0,
      CLOSE_VOL: 0,
      TREND_EFFICIENCY: 0,
      UP_MOVE_RATIO: 0,
      AVG_RANGE_PCT: 0,
      AVG_BODY_PCT: 0,
      WICK_IMBALANCE: 0,
      RANGE_POSITION: 0.5,
      DRAWDOWN_FROM_HIGH: 0,
      REBOUND_FROM_LOW: 0,
      VOLUME_SLOPE_NORM: 0,
      VOLUME_SPIKE: 0,
      BREAKOUT_ABOVE_PREV_HIGH: 0,
      BREAKOUT_BELOW_PREV_LOW: 0,
    };
  }

  const closes = candles.map((candle) => toFinite(candle.close, 0));
  const opens = candles.map((candle) => toFinite(candle.open, 0));
  const highs = candles.map((candle) => toFinite(candle.high, 0));
  const lows = candles.map((candle) => toFinite(candle.low, 0));
  const volumes = candles.map((candle) =>
    Math.log1p(Math.max(0, candle.volume)),
  );
  const rangesPct = candles.map((candle) =>
    safeDiv(
      Math.max(0, candle.high - candle.low),
      Math.abs(candle.close) + 1e-9,
    ),
  );
  const bodyPct = candles.map((candle) =>
    safeDiv(
      Math.abs(candle.close - candle.open),
      Math.abs(candle.close) + 1e-9,
    ),
  );
  const wickImbalance = candles.map((candle) => {
    const range = Math.max(0, candle.high - candle.low);
    if (range === 0) return 0;
    const upper = candle.high - Math.max(candle.open, candle.close);
    const lower = Math.min(candle.open, candle.close) - candle.low;
    return clamp(safeDiv(upper - lower, range), -1, 1);
  });
  const closeReturns = simpleReturns(closes);

  let upMoves = 0;
  let absMoveSum = 0;
  for (let i = 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) upMoves += 1;
    absMoveSum += Math.abs(diff);
  }

  const firstClose = closes[0] ?? 0;
  const lastClose = closes[closes.length - 1] ?? 0;
  const netMove = lastClose - firstClose;
  const closeSlope = linearSlope(closes);
  const highMax = highs.length ? Math.max(...highs) : 0;
  const lowMin = lows.length ? Math.min(...lows) : 0;
  const windowRange = Math.max(0, highMax - lowMin);
  const prevHigh =
    highs.length > 1 ? Math.max(...highs.slice(0, highs.length - 1)) : highMax;
  const prevLow =
    lows.length > 1 ? Math.min(...lows.slice(0, lows.length - 1)) : lowMin;

  return {
    CLOSE_NET_RET: clamp(safeDiv(lastClose, firstClose) - 1, -5, 5),
    CLOSE_SLOPE_NORM: Math.tanh(
      safeDiv(closeSlope, Math.abs(firstClose) + 1e-9),
    ),
    CLOSE_VOL: std(closeReturns),
    TREND_EFFICIENCY: clamp(safeDiv(Math.abs(netMove), absMoveSum), 0, 1),
    UP_MOVE_RATIO: clamp(
      safeDiv(upMoves, Math.max(1, closes.length - 1)),
      0,
      1,
    ),
    AVG_RANGE_PCT: clamp(mean(rangesPct), 0, 5),
    AVG_BODY_PCT: clamp(mean(bodyPct), 0, 5),
    WICK_IMBALANCE: mean(wickImbalance),
    RANGE_POSITION: clamp(safeDiv(lastClose - lowMin, windowRange || 1), 0, 1),
    DRAWDOWN_FROM_HIGH: clamp(
      safeDiv(highMax - lastClose, Math.abs(lastClose) + 1e-9),
      0,
      5,
    ),
    REBOUND_FROM_LOW: clamp(
      safeDiv(lastClose - lowMin, Math.abs(lastClose) + 1e-9),
      -5,
      5,
    ),
    VOLUME_SLOPE_NORM: Math.tanh(linearSlope(volumes)),
    VOLUME_SPIKE: clamp(
      safeDiv(volumes[volumes.length - 1] ?? 0, median(volumes) || 1),
      0,
      10,
    ),
    BREAKOUT_ABOVE_PREV_HIGH: clamp(
      safeDiv(lastClose - prevHigh, Math.abs(lastClose) + 1e-9),
      -5,
      5,
    ),
    BREAKOUT_BELOW_PREV_LOW: clamp(
      safeDiv(prevLow - lastClose, Math.abs(lastClose) + 1e-9),
      -5,
      5,
    ),
  };
};

export const analyzeMlSeriesWindow = (
  input: MlSeriesAnalysisInput,
): MlSeriesAnalysisSummary => {
  const summary: MlSeriesAnalysisSummary = {
    ...candleCoreSummary(input.candles),
  };

  const benchmark = input.benchmarkCandles;
  if (benchmark?.length) {
    const benchSummary = candleCoreSummary(benchmark);
    const closeNetRet = summary.CLOSE_NET_RET ?? 0;
    const benchNetRet = benchSummary.CLOSE_NET_RET ?? 0;
    const closeSlopeNorm = summary.CLOSE_SLOPE_NORM ?? 0;
    const benchSlopeNorm = benchSummary.CLOSE_SLOPE_NORM ?? 0;
    summary.REL_BENCH_NET_RET = clamp(closeNetRet - benchNetRet, -5, 5);
    summary.REL_BENCH_SLOPE_GAP = clamp(closeSlopeNorm - benchSlopeNorm, -2, 2);
    summary.REL_BENCH_TREND_ALIGN = clamp(
      sign(closeSlopeNorm) * sign(benchSlopeNorm),
      -1,
      1,
    );
    summary.REL_BENCH_VOL_RATIO = clamp(
      safeDiv(summary.CLOSE_VOL ?? 0, benchSummary.CLOSE_VOL ?? 0),
      0,
      10,
    );
  }

  const indicatorMap = input.indicators;
  if (indicatorMap) {
    const indicatorEntries: Array<[string, number[] | undefined]> = [
      ['ATR_PCT', indicatorMap.atrPct],
      ['PRICE1H_PCNT', indicatorMap.price1hPcnt],
      ['PRICE24H_PCNT', indicatorMap.price24hPcnt],
      ['MACD_HIST', indicatorMap.macdHistogram],
    ];
    for (const [prefix, maybeSeries] of indicatorEntries) {
      const series = (maybeSeries ?? []).filter((value) =>
        Number.isFinite(value),
      );
      if (!series.length) continue;
      const stats = analyzeNumericSeries(series);
      summary[`${prefix}_LAST`] = stats.LAST ?? 0;
      summary[`${prefix}_MEAN`] = stats.MEAN ?? 0;
      summary[`${prefix}_STD`] = stats.STD ?? 0;
      summary[`${prefix}_SLOPE_NORM`] = stats.SLOPE_NORM ?? 0;
      summary[`${prefix}_Z_LAST`] = stats.Z_LAST ?? 0;
      summary[`${prefix}_RANK_LAST`] = stats.RANK_LAST ?? 0;
    }

    const maFast = (indicatorMap.maFast ?? []).filter((v) =>
      Number.isFinite(v),
    );
    const maSlow = (indicatorMap.maSlow ?? []).filter((v) =>
      Number.isFinite(v),
    );
    if (maFast.length && maSlow.length) {
      const length = Math.min(maFast.length, maSlow.length);
      const spread = Array.from({ length }, (_, i) =>
        clamp(
          safeDiv(
            maFast[maFast.length - length + i] -
              maSlow[maSlow.length - length + i],
            maSlow[maSlow.length - length + i] || 1,
          ),
          -5,
          5,
        ),
      );
      const spreadStats = analyzeNumericSeries(spread);
      summary.MA_FAST_SLOW_SPREAD_LAST = spreadStats.LAST ?? 0;
      summary.MA_FAST_SLOW_SPREAD_SLOPE_NORM = spreadStats.SLOPE_NORM ?? 0;
      summary.MA_FAST_SLOW_SPREAD_Z_LAST = spreadStats.Z_LAST ?? 0;
    }
  }

  return summary;
};

export const buildMlSeriesAlignment = (
  left: MlSeriesAnalysisSummary | undefined,
  right: MlSeriesAnalysisSummary | undefined,
): MlSeriesAnalysisSummary => {
  const leftSlope = left?.CLOSE_SLOPE_NORM ?? 0;
  const rightSlope = right?.CLOSE_SLOPE_NORM ?? 0;
  const leftRet = left?.CLOSE_NET_RET ?? 0;
  const rightRet = right?.CLOSE_NET_RET ?? 0;
  const leftEfficiency = left?.TREND_EFFICIENCY ?? 0;
  const rightEfficiency = right?.TREND_EFFICIENCY ?? 0;

  return {
    TREND_ALIGN_SIGN: clamp(sign(leftSlope) * sign(rightSlope), -1, 1),
    TREND_SLOPE_GAP: clamp(leftSlope - rightSlope, -2, 2),
    NET_RET_GAP: clamp(leftRet - rightRet, -5, 5),
    EFFICIENCY_GAP: clamp(leftEfficiency - rightEfficiency, -1, 1),
    CONFLUENCE_SCORE: clamp(
      leftSlope *
        rightSlope *
        (0.5 + 0.5 * Math.min(leftEfficiency, rightEfficiency)),
      -1,
      1,
    ),
  };
};
