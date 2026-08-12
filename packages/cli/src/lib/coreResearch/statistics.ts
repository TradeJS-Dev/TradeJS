import { createHash } from 'node:crypto';
import { DAY_MS } from './metrics';
import type { CoreResearchBootstrapResult, CoreResearchTrade } from './types';

const createSeededRandom = (seedText: string) => {
  const digest = createHash('sha256').update(seedText).digest();
  let state = digest.readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const percentile = (sorted: number[], probability: number) => {
  if (!sorted.length) return Number.NaN;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(probability * sorted.length)),
  );
  return sorted[index];
};

export const calendarClusterBootstrap = (params: {
  control: CoreResearchTrade[];
  candidate: CoreResearchTrade[];
  clusterDays: number;
  iterations: number;
  confidenceLevel: number;
  seed: string;
  start?: number;
  end?: number;
}): CoreResearchBootstrapResult => {
  const clusterMs = params.clusterDays * DAY_MS;
  const buckets = new Map<number, { control: number; candidate: number }>();
  if (params.start != null && params.end != null && params.end > params.start) {
    const first = Math.floor(params.start / clusterMs);
    const last = Math.ceil(params.end / clusterMs);
    for (let bucket = first; bucket < last; bucket += 1) {
      buckets.set(bucket, { control: 0, candidate: 0 });
    }
  }
  const add = (trades: CoreResearchTrade[], field: 'control' | 'candidate') => {
    for (const trade of trades) {
      const bucket = Math.floor(trade.exitTimestamp / clusterMs);
      const current = buckets.get(bucket) ?? { control: 0, candidate: 0 };
      current[field] += trade.netProfit;
      buckets.set(bucket, current);
    }
  };
  add(params.control, 'control');
  add(params.candidate, 'candidate');
  const deltas = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value.candidate - value.control);
  if (!deltas.length) {
    return {
      method: 'calendar-cluster-bootstrap',
      clusterDays: params.clusterDays,
      iterations: params.iterations,
      confidenceLevel: params.confidenceLevel,
      observedMeanPnlDelta: null,
      confidenceInterval: null,
      probabilityPositive: null,
      oneSidedPValue: null,
      holmAdjustedPValue: null,
    };
  }
  const random = createSeededRandom(params.seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < params.iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      sum += deltas[Math.floor(random() * deltas.length)];
    }
    samples.push(sum / deltas.length);
  }
  samples.sort((left, right) => left - right);
  const alpha = 1 - params.confidenceLevel;
  const positive = samples.filter((value) => value > 0).length;
  const probabilityPositive = positive / samples.length;
  return {
    method: 'calendar-cluster-bootstrap',
    clusterDays: params.clusterDays,
    iterations: params.iterations,
    confidenceLevel: params.confidenceLevel,
    observedMeanPnlDelta:
      deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
    confidenceInterval: [
      percentile(samples, alpha / 2),
      percentile(samples, 1 - alpha / 2),
    ],
    probabilityPositive,
    oneSidedPValue: 1 - probabilityPositive,
    holmAdjustedPValue: null,
  };
};

export const applyHolmCorrection = (
  results: CoreResearchBootstrapResult[],
  familyHypotheses = results.length,
) => {
  const ranked = results
    .map((result, index) => ({
      index,
      p: result.oneSidedPValue,
    }))
    .filter((entry): entry is { index: number; p: number } => entry.p != null)
    .sort((left, right) => left.p - right.p);
  let previous = 0;
  ranked.forEach((entry, rank) => {
    const adjusted = Math.min(
      1,
      Math.max(previous, entry.p * Math.max(1, familyHypotheses - rank)),
    );
    results[entry.index].holmAdjustedPValue = adjusted;
    previous = adjusted;
  });
};

const inverseNormalCdf = (probability: number): number => {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - 0.02425) return -inverseNormalCdf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
      q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
};

const erf = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
};

const normalCdf = (value: number) => 0.5 * (1 + erf(value / Math.SQRT2));

export const deflatedSharpeDiagnostic = (returns: number[], trials: number) => {
  const periods = returns.length;
  if (periods < 3) {
    return {
      periods,
      observedSharpe: null,
      expectedMaximumSharpe: null,
      probabilityAboveSelectionBias: null,
    };
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / periods;
  const centered = returns.map((value) => value - mean);
  const variance =
    centered.reduce((sum, value) => sum + value * value, 0) / (periods - 1);
  const standardDeviation = Math.sqrt(variance);
  if (!(standardDeviation > 0)) {
    return {
      periods,
      observedSharpe: null,
      expectedMaximumSharpe: null,
      probabilityAboveSelectionBias: null,
    };
  }
  const observedSharpe = mean / standardDeviation;
  const skew =
    centered.reduce((sum, value) => sum + (value / standardDeviation) ** 3, 0) /
    periods;
  const kurtosis =
    centered.reduce((sum, value) => sum + (value / standardDeviation) ** 4, 0) /
    periods;
  const expectedMaximumSharpe = inverseNormalCdf(
    (Math.max(1, trials) - 0.375) / (Math.max(1, trials) + 0.25),
  );
  const standardError = Math.sqrt(
    Math.max(
      1e-12,
      (1 - skew * observedSharpe + ((kurtosis - 1) / 4) * observedSharpe ** 2) /
        (periods - 1),
    ),
  );
  return {
    periods,
    observedSharpe,
    expectedMaximumSharpe,
    probabilityAboveSelectionBias: normalCdf(
      (observedSharpe - expectedMaximumSharpe) / standardError,
    ),
  };
};

const combinations = (items: number[], choose: number) => {
  const output: number[][] = [];
  const visit = (start: number, selected: number[]) => {
    if (output.length >= 512) return;
    if (selected.length === choose) {
      output.push(selected);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      visit(index + 1, [...selected, items[index]]);
    }
  };
  visit(0, []);
  return output;
};

export const probabilityOfBacktestOverfitting = (
  performanceByVariant: number[][],
) => {
  const blocks = Math.min(
    ...performanceByVariant.map((performance) => performance.length),
  );
  if (performanceByVariant.length < 2 || blocks < 4) {
    return { method: 'CSCV' as const, combinations: 0, probability: null };
  }
  if (
    performanceByVariant.every((performance) =>
      performance
        .slice(0, blocks)
        .every((value, index) => value === performanceByVariant[0][index]),
    )
  ) {
    return { method: 'CSCV' as const, combinations: 0, probability: null };
  }
  const usableBlocks = blocks % 2 === 0 ? blocks : blocks - 1;
  const blockIndexes = Array.from(
    { length: usableBlocks },
    (_, index) => index,
  );
  const splits = combinations(blockIndexes, usableBlocks / 2);
  let belowMedian = 0;
  for (const inSample of splits) {
    const inSet = new Set(inSample);
    const outSample = blockIndexes.filter((index) => !inSet.has(index));
    const inScores = performanceByVariant.map((performance) =>
      inSample.reduce((sum, index) => sum + performance[index], 0),
    );
    const selected = inScores.indexOf(Math.max(...inScores));
    const outScores = performanceByVariant.map((performance) =>
      outSample.reduce((sum, index) => sum + performance[index], 0),
    );
    const sorted = [...outScores].sort((left, right) => left - right);
    const rankAscending = sorted.indexOf(outScores[selected]);
    const omega = (rankAscending + 1) / (outScores.length + 1);
    if (Math.log(omega / (1 - omega)) < 0) belowMedian += 1;
  }
  return {
    method: 'CSCV' as const,
    combinations: splits.length,
    probability: splits.length ? belowMedian / splits.length : null,
  };
};
