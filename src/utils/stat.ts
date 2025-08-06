import {
  OrderLogData,
  OrderLog,
  PositionLogData,
  BacktestStat,
  MetricScore,
  ThresholdLevel,
  BacktestThresholds,
  WorkerResult,
} from '@types';
import { backtestThresholds, levelScore, rankedMetrics } from '@constants';

export const buildPositionLogFromOrderLog = (
  orderLogData: OrderLogData,
): PositionLogData => {
  const result: PositionLogData = [];
  let currentOpen: OrderLog | null = null;
  let currentQty = 0;

  for (const order of orderLogData) {
    if (order.type.startsWith('OPEN')) {
      currentOpen = order;
      currentQty = order.qty;
    } else if (currentOpen) {
      // Вычитаем закрытую часть
      currentQty = parseFloat((currentQty - order.qty).toFixed(8));

      // Если позиция полностью закрыта (последний TP / SL / CLOSE)
      if (
        currentQty <= 0 &&
        (order.type.startsWith('CLOSE') ||
          order.type.startsWith('STOP_LOSS') ||
          order.type.startsWith('TAKE_PROFIT'))
      ) {
        result.push({
          open: {
            amount: currentOpen.amount + currentOpen.fee!,
            timestamp: currentOpen.timestamp,
          },
          close: {
            amount: order.amount,
            timestamp: order.timestamp,
          },
        });

        currentOpen = null;
        currentQty = 0;
      }
    }
  }

  return result;
};

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
): BacktestStat | null => {
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
    amount: positionLogData[positionLogData.length - 1].close.amount,
    maxAmount: Math.max(...allAmounts),
    minAmount: Math.min(...allAmounts),
    wins: wins.length,
    losses: losses.length,
    orders: positionLogData.length,
    netProfit,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    riskRewardRatio: avgLoss > 0 ? avgWin / avgLoss : null,
    expectancy,
    winRate,
    averageReturn: mean,
    sharpeRatio,
    sortinoRatio,
    exposure,
    maxDrawdown,
  };
};

export const classifyMetric = (
  name: keyof typeof backtestThresholds,
  value: number,
): ThresholdLevel => {
  const { thresholds, direction } = backtestThresholds[name];

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

export const getBacktestScore = (stat: Partial<BacktestStat>): number => {
  if (stat.score) {
    return stat.score;
  }

  let totalWeightedScore = 0;
  let totalWeight = 0;

  const breakdown: Record<string, MetricScore> = {};

  for (const metricName in backtestThresholds) {
    const key = metricName as keyof BacktestThresholds;

    if (!rankedMetrics.includes(key)) {
      continue;
    }

    const config = backtestThresholds[key];
    const value = stat[key];

    if (!config || value == null || Number.isNaN(value)) {
      continue;
    }

    const level = classifyMetric(key, value);
    const score = levelScore[level];

    totalWeightedScore += score * config.weight;
    totalWeight += config.weight;

    breakdown[key] = {
      level,
      score,
      weight: config.weight,
    };
  }

  const normalizedScore =
    totalWeight > 0 ? (totalWeightedScore / totalWeight) * 100 : 0;

  return Math.round(normalizedScore * 10) / 10;
};

export const rankBacktests = (
  results: WorkerResult[],
  limit: number = 5,
): WorkerResult[] => {
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
    .sort((a, b) => (b.stat.score ?? 0) - (a.stat.score ?? 0))
    .slice(0, limit);
};

export const getFormatted = (
  stat: BacktestStat,
  key: keyof BacktestThresholds,
) => {
  const raw = stat[key];

  if (raw == null || typeof raw === 'string') {
    return {
      formatted: String(raw ?? '-'),
      level: 'error' as ThresholdLevel,
    };
  }

  const config = backtestThresholds[key as keyof typeof backtestThresholds];

  const level = config
    ? classifyMetric(key as keyof typeof backtestThresholds, raw)
    : 'success';

  const formatted = config
    ? `${raw.toFixed(config.precision)}${config.isPercent ? '%' : ''}${config.isAmount ? '$' : ''}`
    : String(raw);

  return {
    formatted,
    level,
  };
};
