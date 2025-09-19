import {
  PositionLogData,
  TestStat,
  MetricScore,
  ThresholdLevel,
  TestThresholdsKey,
  TestWorkerResult,
} from '@types';
import {
  TestThresholdsConfig,
  levelScore,
  TESTS_ORDERS_MIN_LIMIT,
} from '@constants';
import { round } from '@utils/math';

export const calculateMaxDrawdown = (amounts: number[]): number => {
  let max = amounts[0];
  let maxDrawdown = 0;

  for (const amount of amounts) {
    if (amount > max) {
      max = amount;
    }
    const drawdown = ((max - amount) / max) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
};

export const calculateStatsFull = (
  positionLogData: PositionLogData,
): TestStat | null => {
  if (!positionLogData.length) return null;

  const returns = positionLogData.map((p) => p.close.amount - p.open.amount);
  const durations = positionLogData.map(
    (p) => p.close.timestamp - p.open.timestamp,
  );

  const grossProfit = returns.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(
    returns.filter((p) => p < 0).reduce((a, b) => a + b, 0),
  );
  const netProfit = returns.reduce((a, b) => a + b, 0);

  const wins = returns.filter((p) => p > 0);
  const losses = returns.filter((p) => p < 0);

  const avgWin = wins.length
    ? wins.reduce((a, b) => a + b, 0) / wins.length
    : 0;
  const avgLoss = losses.length
    ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length)
    : 0;
  const winRate = returns.length ? (wins.length / returns.length) * 100 : 0;

  const expectancy =
    (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  const mean = netProfit / returns.length;
  const std = Math.sqrt(
    returns.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) /
      returns.length,
  );
  const downsideStd = Math.sqrt(
    returns.filter((r) => r < 0).reduce((acc, val) => acc + val * val, 0) /
      (returns.filter((r) => r < 0).length || 1),
  );

  const sharpeRatio = std > 0 ? mean / std : null;
  const sortinoRatio = downsideStd > 0 ? mean / downsideStd : null;

  const allTimestamps = positionLogData.flatMap((p) => [
    p.open.timestamp,
    p.close.timestamp,
  ]);
  const allAmounts = positionLogData.flatMap((p) => [
    p.open.amount,
    p.close.amount,
  ]);

  const totalTime = Math.max(...allTimestamps) - Math.min(...allTimestamps);
  const timeInMarket = durations.reduce((a, b) => a + b, 0);
  const exposure = totalTime > 0 ? (timeInMarket / totalTime) * 100 : 0;

  const maxDrawdown = calculateMaxDrawdown(allAmounts);

  return {
    amount: round(positionLogData[positionLogData.length - 1].close.amount),
    maxAmount: round(Math.max(...allAmounts)),
    minAmount: round(Math.min(...allAmounts)),
    wins: wins.length,
    losses: losses.length,
    orders: positionLogData.length,
    netProfit: round(netProfit),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : Infinity,
    riskRewardRatio: avgLoss > 0 ? round(avgWin / avgLoss) : null,
    expectancy: round(expectancy),
    winRate: round(winRate),
    averageReturn: round(mean),
    sharpeRatio: sharpeRatio === null ? null : round(sharpeRatio),
    sortinoRatio: sortinoRatio === null ? null : round(sortinoRatio),
    exposure: round(exposure),
    maxDrawdown: round(maxDrawdown),
  };
};

export const classifyMetric = (
  name: TestThresholdsKey,
  value: number,
): ThresholdLevel => {
  const { thresholds, direction } = TestThresholdsConfig[name];

  if (direction === 'higher') {
    if (value >= thresholds[1]) return 'success';
    if (value >= thresholds[0]) return 'warning';
    return 'error';
  } else {
    if (value <= thresholds[1]) return 'success';
    if (value <= thresholds[0]) return 'warning';
    return 'error';
  }
};

export const getBacktestScore = (stat: Partial<TestStat>): number => {
  if (stat.score !== undefined) {
    return stat.score;
  }

  if (stat.orders && stat.orders < TESTS_ORDERS_MIN_LIMIT) {
    return 0;
  }

  let totalWeightedScore = 0;
  let totalWeight = 0;

  const breakdown: Record<string, MetricScore> = {};

  for (const metricName in TestThresholdsConfig) {
    const key = metricName as TestThresholdsKey;

    const config = TestThresholdsConfig[key];
    const value = stat[key];

    if (!config || !config.isScored || value == null || Number.isNaN(value)) {
      continue;
    }

    const level = classifyMetric(key, value);
    const score = levelScore[level];

    const points = score * config.weight;

    totalWeightedScore +=
      config.direction === 'higher' ? points * value : points * (1 / value);
    totalWeight += config.weight;

    breakdown[key] = {
      level,
      score,
      weight: config.weight,
    };
  }

  const normalizedScore =
    totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0;

  return round(normalizedScore, 1);
};

export const rankBacktests = (
  results: TestWorkerResult[],
  limit: number = 5,
): TestWorkerResult[] => {
  return results
    .map((item) => {
      const score = getBacktestScore(item.stat);
      return {
        ...item,
        stat: {
          ...item.stat,
          score,
        },
      };
    })
    .sort((a, b) => (b.stat.netProfit ?? 0) - (a.stat.netProfit ?? 0))
    .slice(0, limit);
};

export const getFormatted = (
  stat: TestStat | undefined,
  key: TestThresholdsKey,
) => {
  if (!stat) {
    return {
      formatted: '0',
      level: 'error' as ThresholdLevel,
    };
  }

  const raw = stat[key];

  if (raw == null || typeof raw === 'string') {
    return {
      formatted: String(raw ?? '-'),
      level: 'error' as ThresholdLevel,
    };
  }

  const config = TestThresholdsConfig[key as TestThresholdsKey];

  const level = config
    ? classifyMetric(key as TestThresholdsKey, raw)
    : 'success';

  const formatted = config
    ? `${raw.toFixed(config.precision)}${config.isPercent ? '%' : ''}${config.isAmount ? '$' : ''}`
    : String(raw);

  return {
    formatted,
    level,
  };
};
