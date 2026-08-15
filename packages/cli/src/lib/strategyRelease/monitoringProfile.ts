import type { StrategyReleaseManifest } from '@tradejs/types';

const DAY_MS = 86_400_000;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid strategy release: ${message}`);
}

type MonitoringTrade = {
  exitTimestamp: number;
  netProfit: number;
};

const realizedDrawdown = (
  trades: MonitoringTrade[],
  startIndex = 0,
  endIndex = trades.length,
) => {
  let equity = 0;
  let peak = 0;
  let maximum = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    const trade = trades[index];
    equity += trade.netProfit;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return maximum;
};

const lowerBoundExitTimestamp = (
  trades: MonitoringTrade[],
  timestamp: number,
) => {
  let left = 0;
  let right = trades.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (trades[middle].exitTimestamp < timestamp) left = middle + 1;
    else right = middle;
  }
  return left;
};

const percentile = (values: number[], probability: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return (
    sorted[lower] * (upper - position) + sorted[upper] * (position - lower)
  );
};

export const buildStrategyMonitoringProfile = ({
  trades,
  startTime,
  endTime,
  days,
  minimumProspectiveClosedTrades = 20,
  minimumParityRatio = 0.95,
  maximumOrderFailureRate = 0.05,
  minimumRegimeCoverage = 0.5,
  aiGateExpectancy = null,
  overfitProbability = null,
}: {
  trades: MonitoringTrade[];
  startTime: number;
  endTime: number;
  days: number[];
  minimumProspectiveClosedTrades?: number;
  minimumParityRatio?: number;
  maximumOrderFailureRate?: number;
  minimumRegimeCoverage?: number;
  aiGateExpectancy?: number | null;
  overfitProbability?: number | null;
}): StrategyReleaseManifest['monitoring'] => {
  assert(endTime > startTime, 'monitoring profile window is invalid');
  assert(days.length > 0, 'monitoring profile days are required');
  const ordered = trades
    .filter(
      (trade) =>
        Number.isFinite(trade.exitTimestamp) &&
        Number.isFinite(trade.netProfit) &&
        trade.exitTimestamp >= startTime &&
        trade.exitTimestamp < endTime,
    )
    .sort((left, right) => left.exitTimestamp - right.exitTimestamp);
  const drawdownEnvelopes = [...new Set(days)]
    .sort((left, right) => left - right)
    .map((windowDays) => {
      assert(
        Number.isInteger(windowDays) && windowDays > 0,
        'monitoring profile days must be positive integers',
      );
      const duration = windowDays * DAY_MS;
      assert(
        endTime - startTime >= duration,
        `${windowDays}d monitoring window exceeds historical coverage`,
      );
      const drawdowns: number[] = [];
      for (
        let windowStart = startTime;
        windowStart + duration <= endTime;
        windowStart += DAY_MS
      ) {
        const windowEnd = windowStart + duration;
        drawdowns.push(
          realizedDrawdown(
            ordered,
            lowerBoundExitTimestamp(ordered, windowStart),
            lowerBoundExitTimestamp(ordered, windowEnd),
          ),
        );
      }
      return {
        days: windowDays,
        p95: percentile(drawdowns, 0.95),
        maximum: Math.max(...drawdowns),
      };
    });
  return {
    minimumProspectiveClosedTrades,
    minimumParityRatio,
    maximumOrderFailureRate,
    minimumRegimeCoverage,
    drawdownEnvelopes,
    rawCoreExpectancy: ordered.length
      ? ordered.reduce((sum, trade) => sum + trade.netProfit, 0) /
        ordered.length
      : null,
    aiGateExpectancy,
    overfitProbability,
  };
};
