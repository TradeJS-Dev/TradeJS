import type { HyperliquidUserFill } from './hyperliquidWhaleData';

export const HYPERLIQUID_WHALE_SELECTION = {
  minimumAccountValueUsd: 500_000,
  minimumActiveDays: 1,
  maximumRawFillsPerDay: 20,
  maximumDirectionalExecutionsPerDay: 10,
  minimumMedianNotionalUsd: 0,
  minimumMedianInterExecutionMinutes: 0,
  minimumTop30NotionalShare: 0.001,
  minimumTurnoverToEquity: 0.05,
  maximumTurnoverToEquity: 5,
} as const;

export type HyperliquidWhaleStructuralMetrics = {
  address: string;
  accountValueUsd: number;
  rawFills: number;
  rawFillsPerDay: number;
  directionalExecutions: number;
  directionalExecutionsPerDay: number;
  activeDays: number;
  medianNotionalUsd: number;
  medianInterExecutionMinutes: number;
  top30NotionalShare: number;
  score: number;
  eligible: boolean;
};

const finiteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const evaluateHyperliquidWhaleStructure = (params: {
  address: string;
  accountValueUsd: number;
  fills: HyperliquidUserFill[];
  calibrationFromMs: number;
  calibrationToMs: number;
  top30Symbols: ReadonlySet<string>;
}): HyperliquidWhaleStructuralMetrics => {
  const fills = params.fills
    .filter((fill) => {
      const time = finiteNumber(fill.time);
      return time >= params.calibrationFromMs && time < params.calibrationToMs;
    })
    .sort((left, right) => finiteNumber(left.time) - finiteNumber(right.time));
  const days = Math.max(
    1,
    (params.calibrationToMs - params.calibrationFromMs) / 86_400_000,
  );
  const executions = fills.reduce<
    Array<{ coin: string; side: string; time: number; notionalUsd: number }>
  >((clusters, fill) => {
    const coin = String(fill.coin);
    const side = String(fill.side);
    const time = finiteNumber(fill.time);
    const notionalUsd = Math.abs(finiteNumber(fill.px) * finiteNumber(fill.sz));
    const previous = clusters.at(-1);
    if (
      previous &&
      previous.coin === coin &&
      previous.side === side &&
      time - previous.time <= 60_000
    ) {
      previous.time = time;
      previous.notionalUsd += notionalUsd;
    } else {
      clusters.push({ coin, side, time, notionalUsd });
    }
    return clusters;
  }, []);
  const notionals = executions.map((execution) => execution.notionalUsd);
  const totalNotional = notionals.reduce((sum, value) => sum + value, 0);
  const top30Notional = executions.reduce(
    (sum, execution) =>
      sum +
      (params.top30Symbols.has(execution.coin) ? execution.notionalUsd : 0),
    0,
  );
  const interExecutionMinutes = executions
    .slice(1)
    .map(
      (execution, index) => (execution.time - executions[index].time) / 60_000,
    )
    .filter((value) => value >= 0);
  const activeDays = new Set(
    fills.map((fill) =>
      new Date(finiteNumber(fill.time)).toISOString().slice(0, 10),
    ),
  ).size;
  const rawFillsPerDay = fills.length / days;
  const directionalExecutionsPerDay = executions.length / days;
  const medianNotionalUsd = median(notionals);
  const medianInterExecutionMinutes = median(interExecutionMinutes);
  const top30NotionalShare =
    totalNotional > 0 ? top30Notional / totalNotional : 0;
  const eligible =
    params.accountValueUsd >=
      HYPERLIQUID_WHALE_SELECTION.minimumAccountValueUsd &&
    activeDays >= HYPERLIQUID_WHALE_SELECTION.minimumActiveDays &&
    rawFillsPerDay <= HYPERLIQUID_WHALE_SELECTION.maximumRawFillsPerDay &&
    directionalExecutionsPerDay <=
      HYPERLIQUID_WHALE_SELECTION.maximumDirectionalExecutionsPerDay &&
    medianNotionalUsd >= HYPERLIQUID_WHALE_SELECTION.minimumMedianNotionalUsd &&
    medianInterExecutionMinutes >=
      HYPERLIQUID_WHALE_SELECTION.minimumMedianInterExecutionMinutes &&
    top30NotionalShare >= HYPERLIQUID_WHALE_SELECTION.minimumTop30NotionalShare;
  const score =
    (Math.log1p(params.accountValueUsd) *
      Math.log1p(medianNotionalUsd) *
      Math.log1p(Math.max(1, medianInterExecutionMinutes)) *
      Math.sqrt(Math.max(0, activeDays)) *
      top30NotionalShare) /
    Math.sqrt(1 + rawFillsPerDay);

  return {
    address: params.address.toLowerCase(),
    accountValueUsd: params.accountValueUsd,
    rawFills: fills.length,
    rawFillsPerDay,
    directionalExecutions: executions.length,
    directionalExecutionsPerDay,
    activeDays,
    medianNotionalUsd,
    medianInterExecutionMinutes,
    top30NotionalShare,
    score,
    eligible,
  };
};

export const rankHyperliquidStructuralWhales = (
  metrics: HyperliquidWhaleStructuralMetrics[],
  limit = 100,
) =>
  metrics
    .filter((row) => row.eligible)
    .sort(
      (left, right) =>
        right.score - left.score || left.address.localeCompare(right.address),
    )
    .slice(0, limit);
