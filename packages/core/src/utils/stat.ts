import {
  startOfMonth,
  endOfMonth,
  addMonths,
  differenceInMilliseconds,
} from 'date-fns';

import {
  PositionLogData,
  TestStat,
  ThresholdLevel,
  TestThresholdsKey,
  TestWorkerResult,
  MonthlyEquityStats,
  EOMPoint,
} from '@tradejs/types';
import { TestThresholdsConfig } from '../constants';
import { round, absReturns, relReturns, equityPoints, mean, sum } from './math';

/**
 * Максимальные стрики побед/поражений по абсолютным ретёрнам на сделку.
 * Нулевая сделка (r===0) сбрасывает обе серии.
 */
const calcStreaks = (retsAbs: number[]) => {
  let maxW = 0,
    maxL = 0,
    cw = 0,
    cl = 0;
  for (const r of retsAbs) {
    if (r > 0) {
      cw++;
      cl = 0;
      if (cw > maxW) maxW = cw;
    } else if (r < 0) {
      cl++;
      cw = 0;
      if (cl > maxL) maxL = cl;
    } else {
      // r === 0 → сброс обеих серий
      cw = 0;
      cl = 0;
    }
  }
  return { maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL };
};

/**
 * Максимальная просадка (Max Drawdown) в процентах от бегающего пика.
 * Формула по точкам amount_t:
 *   peak_t = max(amount_0..t)
 *   drawdown_t = (peak_t - amount_t) / peak_t * 100
 *   MaxDD = max_t(drawdown_t)
 * Ожидается, что amounts — это последовательные значения equity и > 0.
 */
export const calculateMaxDrawdown = (amounts: number[]): number => {
  let max = amounts[0];
  let maxDrawdown = 0;

  for (const amount of amounts) {
    if (amount > max) {
      max = amount; // обновляем пик
    }
    const drawdown = ((max - amount) / max) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
};

export type AdvancedTradeDirection = 'LONG' | 'SHORT' | string;

export interface AdvancedTradeInput {
  id?: string;
  timestamp: number;
  pnl: number;
  symbol?: string | null;
  direction?: AdvancedTradeDirection | null;
  grossPnl?: number | null;
  slippageCost?: number | null;
  approved?: boolean | null;
  blocked?: boolean | null;
  session?: string | null;
}

export interface AdvancedQuarterlyPnl {
  quarter: string;
  pnl: number;
}

export interface AdvancedTradeMetrics {
  core: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalPnl: number;
    avgTrade: number | null;
    grossProfit: number;
    grossLoss: number;
    profitFactor: number | null;
    payoffRatio: number | null;
    expectancy: number | null;
    tradesPerDay: number | null;
    tradesPerWeek: number | null;
  };
  risk: {
    maxDrawdown: number | null;
    maxDrawdownPercent: number | null;
    maxDrawdownToTotalProfit: number | null;
    maxDrawdownToGrossProfit: number | null;
    recoveryFactor: number | null;
    maxLossStreak: number;
    losingMonthsCount: number;
    worstMonthPnl: number | null;
    worstRolling30dPnl: number | null;
    worstRolling90dPnl: number | null;
  };
  stability: {
    monthlyWinRate: number | null;
    positiveMonthsPercent: number | null;
    quarterlyPnl: AdvancedQuarterlyPnl[];
    rolling365Pnl: number | null;
    medianMonthlyPnl: number | null;
    iqrMonthlyPnl: number | null;
    top5ProfitShare: number | null;
    top10ProfitShare: number | null;
  };
  distribution: {
    medianTrade: number | null;
    p10Trade: number | null;
    p25Trade: number | null;
    p75Trade: number | null;
    p90Trade: number | null;
    largestWin: number | null;
    largestLoss: number | null;
    tailRatio: number | null;
    skewness: number | null;
  };
  riskAdjusted: {
    sharpeDaily: number | null;
    sortinoDaily: number | null;
    calmar: number | null;
    mar: number | null;
  };
  operational: {
    avgSlippageCost: number | null;
    pnlBeforeSlippage: number | null;
    pnlAfterSlippage: number;
    approvalRate: number | null;
    blockedProfitableTrades: number;
    approvedLosingTrades: number;
    symbolConcentrationTop1: number | null;
    symbolConcentrationTop5: number | null;
    sessionConcentrationTop1: number | null;
    longTrades: number;
    shortTrades: number;
    longPnl: number;
    shortPnl: number;
  };
}

export interface AdvancedTradeMetricsInput {
  trades: AdvancedTradeInput[];
  orderLog?: ReadonlyArray<readonly [number, number]>;
  startTimestamp?: number | null;
  endTimestamp?: number | null;
}

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const DAYS_IN_YEAR = 365;

const isFiniteMetric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const safeRatio = (
  numerator: number | null | undefined,
  denominator: number | null | undefined,
) => {
  if (!isFiniteMetric(numerator) || !isFiniteMetric(denominator)) {
    return null;
  }

  if (Math.abs(denominator) <= Number.EPSILON) {
    return null;
  }

  return numerator / denominator;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sorted[lower];
  }

  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
};

const medianValue = (values: number[]) => percentile(values, 0.5);

const getMonthKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getQuarterKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
};

const resolveTradeSession = (timestamp: number) => {
  const hour = new Date(timestamp).getUTCHours();

  if (hour < 8) {
    return 'Asia';
  }

  if (hour < 16) {
    return 'Europe';
  }

  return 'US';
};

const getDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const calculateDrawdownStats = (
  trades: AdvancedTradeInput[],
  orderLog?: ReadonlyArray<readonly [number, number]>,
) => {
  const explicitPoints = (orderLog ?? [])
    .map((point) => ({ timestamp: point[0], amount: point[1] }))
    .filter(
      (point) =>
        isFiniteMetric(point.timestamp) && isFiniteMetric(point.amount),
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const points = explicitPoints.length
    ? explicitPoints
    : trades
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .reduce<Array<{ timestamp: number; amount: number }>>(
          (acc, trade) => {
            const previous = acc[acc.length - 1]?.amount ?? 0;
            acc.push({
              timestamp: trade.timestamp,
              amount: previous + trade.pnl,
            });
            return acc;
          },
          [{ timestamp: trades[0]?.timestamp ?? 0, amount: 0 }],
        );

  if (!points.length) {
    return { absolute: null, percent: null };
  }

  let peak = points[0].amount;
  let maxAbsolute = 0;
  let maxPercent = 0;

  for (const point of points) {
    if (point.amount > peak) {
      peak = point.amount;
    }

    const absolute = peak - point.amount;
    maxAbsolute = Math.max(maxAbsolute, absolute);

    if (peak > 0) {
      maxPercent = Math.max(maxPercent, (absolute / peak) * 100);
    }
  }

  return { absolute: maxAbsolute, percent: maxPercent };
};

const calculateWorstRollingPnl = (
  trades: AdvancedTradeInput[],
  days: number,
) => {
  if (!trades.length) {
    return null;
  }

  const sorted = trades.slice().sort((a, b) => a.timestamp - b.timestamp);
  const windowMs = days * MS_IN_DAY;
  let start = 0;
  let rollingPnl = 0;
  let worstPnl = 0;

  for (let end = 0; end < sorted.length; end += 1) {
    rollingPnl += sorted[end].pnl;

    while (
      start <= end &&
      sorted[end].timestamp - sorted[start].timestamp > windowMs
    ) {
      rollingPnl -= sorted[start].pnl;
      start += 1;
    }

    worstPnl = Math.min(worstPnl, rollingPnl);
  }

  return worstPnl;
};

const calculateLossStreak = (trades: AdvancedTradeInput[]) => {
  let current = 0;
  let max = 0;

  for (const trade of trades
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)) {
    if (trade.pnl < 0) {
      current += 1;
      max = Math.max(max, current);
      continue;
    }

    current = 0;
  }

  return max;
};

const calculateDailyPnlSeries = (
  trades: AdvancedTradeInput[],
  startTimestamp?: number | null,
  endTimestamp?: number | null,
) => {
  const approvedTrades = trades.filter((trade) => trade.approved !== false);

  if (!approvedTrades.length) {
    return [];
  }

  const firstTimestamp =
    startTimestamp ??
    Math.min(...approvedTrades.map((trade) => trade.timestamp));
  const lastTimestamp =
    endTimestamp ?? Math.max(...approvedTrades.map((trade) => trade.timestamp));

  if (
    !isFiniteMetric(firstTimestamp) ||
    !isFiniteMetric(lastTimestamp) ||
    lastTimestamp < firstTimestamp
  ) {
    return [];
  }

  const startDate = Date.UTC(
    new Date(firstTimestamp).getUTCFullYear(),
    new Date(firstTimestamp).getUTCMonth(),
    new Date(firstTimestamp).getUTCDate(),
  );
  const endDate = Date.UTC(
    new Date(lastTimestamp).getUTCFullYear(),
    new Date(lastTimestamp).getUTCMonth(),
    new Date(lastTimestamp).getUTCDate(),
  );

  const daily = new Map<string, number>();
  for (let ts = startDate; ts <= endDate; ts += MS_IN_DAY) {
    daily.set(getDateKey(ts), 0);
  }

  for (const trade of approvedTrades) {
    const key = getDateKey(trade.timestamp);
    daily.set(key, (daily.get(key) ?? 0) + trade.pnl);
  }

  return [...daily.values()];
};

const calculateStd = (values: number[], valueMean: number) => {
  if (!values.length) {
    return 0;
  }

  return Math.sqrt(
    values.reduce((acc, value) => acc + (value - valueMean) ** 2, 0) /
      values.length,
  );
};

const calculateSkewness = (values: number[]) => {
  if (values.length < 3) {
    return null;
  }

  const valueMean = mean(values);
  const std = calculateStd(values, valueMean);

  if (std <= Number.EPSILON) {
    return null;
  }

  return (
    values.reduce((acc, value) => acc + ((value - valueMean) / std) ** 3, 0) /
    values.length
  );
};

const sumTopPositiveProfitShare = (pnls: number[], count: number) => {
  const grossProfit = pnls
    .filter((pnl) => pnl > 0)
    .reduce((acc, pnl) => acc + pnl, 0);

  if (grossProfit <= 0) {
    return null;
  }

  const topProfit = pnls
    .filter((pnl) => pnl > 0)
    .sort((a, b) => b - a)
    .slice(0, count)
    .reduce((acc, pnl) => acc + pnl, 0);

  return (topProfit / grossProfit) * 100;
};

const concentrationPercent = (
  items: Array<{ key: string; pnl: number }>,
  limit: number,
) => {
  const totals = new Map<string, number>();

  for (const item of items) {
    totals.set(item.key, (totals.get(item.key) ?? 0) + Math.abs(item.pnl));
  }

  const totalAbsPnl = [...totals.values()].reduce(
    (acc, value) => acc + value,
    0,
  );

  if (totalAbsPnl <= 0) {
    return null;
  }

  const topAbsPnl = [...totals.values()]
    .sort((a, b) => b - a)
    .slice(0, limit)
    .reduce((acc, value) => acc + value, 0);

  return (topAbsPnl / totalAbsPnl) * 100;
};

export const calculateAdvancedTradeMetrics = ({
  trades,
  orderLog,
  startTimestamp,
  endTimestamp,
}: AdvancedTradeMetricsInput): AdvancedTradeMetrics => {
  const normalizedTrades = trades
    .filter(
      (trade) =>
        isFiniteMetric(trade.timestamp) &&
        isFiniteMetric(trade.pnl) &&
        trade.timestamp > 0,
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const pnls = normalizedTrades.map((trade) => trade.pnl);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const losses = pnls.filter((pnl) => pnl < 0).length;
  const totalPnl = sum(pnls);
  const grossProfit = pnls
    .filter((pnl) => pnl > 0)
    .reduce((acc, pnl) => acc + pnl, 0);
  const grossLoss = Math.abs(
    pnls.filter((pnl) => pnl < 0).reduce((acc, pnl) => acc + pnl, 0),
  );
  const avgWin = wins ? grossProfit / wins : null;
  const avgLoss = losses ? grossLoss / losses : null;

  const firstTimestamp =
    startTimestamp ?? normalizedTrades[0]?.timestamp ?? null;
  const lastTimestamp =
    endTimestamp ??
    normalizedTrades[normalizedTrades.length - 1]?.timestamp ??
    null;
  const periodDays =
    isFiniteMetric(firstTimestamp) &&
    isFiniteMetric(lastTimestamp) &&
    lastTimestamp > firstTimestamp
      ? (lastTimestamp - firstTimestamp) / MS_IN_DAY
      : null;

  const drawdown = calculateDrawdownStats(normalizedTrades, orderLog);

  const monthly = new Map<
    string,
    { pnl: number; orders: number; wins: number; timestamp: number }
  >();
  const quarterly = new Map<string, number>();

  for (const trade of normalizedTrades) {
    const monthKey = getMonthKey(trade.timestamp);
    const quarterKey = getQuarterKey(trade.timestamp);
    const month = monthly.get(monthKey) ?? {
      pnl: 0,
      orders: 0,
      wins: 0,
      timestamp: trade.timestamp,
    };

    month.pnl += trade.pnl;
    month.orders += 1;
    month.wins += trade.pnl > 0 ? 1 : 0;
    month.timestamp = Math.min(month.timestamp, trade.timestamp);
    monthly.set(monthKey, month);
    quarterly.set(quarterKey, (quarterly.get(quarterKey) ?? 0) + trade.pnl);
  }

  const monthlyStats = [...monthly.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const monthlyPnls = monthlyStats.map(([, stat]) => stat.pnl);
  const monthlyWinRates = monthlyStats.map(([, stat]) =>
    stat.orders ? (stat.wins / stat.orders) * 100 : 0,
  );
  const positiveMonths = monthlyStats.filter(([, stat]) => stat.pnl > 0).length;
  const p25Monthly = percentile(monthlyPnls, 0.25);
  const p75Monthly = percentile(monthlyPnls, 0.75);

  const dailyPnls = calculateDailyPnlSeries(
    normalizedTrades,
    startTimestamp,
    endTimestamp,
  );
  const dailyMean = dailyPnls.length ? mean(dailyPnls) : null;
  const dailyStd =
    dailyMean === null ? null : calculateStd(dailyPnls, dailyMean);
  const downsideDailyPnls = dailyPnls.map((pnl) => Math.min(pnl, 0));
  const downsideStd = downsideDailyPnls.some((pnl) => pnl < 0)
    ? Math.sqrt(
        downsideDailyPnls.reduce((acc, pnl) => acc + pnl ** 2, 0) /
          downsideDailyPnls.length,
      )
    : null;
  const annualizedPnl = dailyMean === null ? null : dailyMean * DAYS_IN_YEAR;

  const approvedFlags = normalizedTrades.filter(
    (trade) => typeof trade.approved === 'boolean',
  );
  const slippageCosts = normalizedTrades
    .map((trade) => trade.slippageCost)
    .filter(isFiniteMetric);
  const pnlBeforeSlippage = normalizedTrades.reduce((acc, trade) => {
    if (isFiniteMetric(trade.grossPnl)) {
      return acc + trade.grossPnl;
    }

    if (isFiniteMetric(trade.slippageCost)) {
      return acc + trade.pnl + trade.slippageCost;
    }

    return acc + trade.pnl;
  }, 0);

  const directionStats = normalizedTrades.reduce(
    (acc, trade) => {
      const direction = String(trade.direction ?? '').toUpperCase();

      if (direction === 'LONG') {
        acc.longTrades += 1;
        acc.longPnl += trade.pnl;
      }

      if (direction === 'SHORT') {
        acc.shortTrades += 1;
        acc.shortPnl += trade.pnl;
      }

      return acc;
    },
    { longTrades: 0, shortTrades: 0, longPnl: 0, shortPnl: 0 },
  );

  return {
    core: {
      trades: normalizedTrades.length,
      wins,
      losses,
      winRate: normalizedTrades.length
        ? (wins / normalizedTrades.length) * 100
        : null,
      totalPnl,
      avgTrade: normalizedTrades.length
        ? totalPnl / normalizedTrades.length
        : null,
      grossProfit,
      grossLoss,
      profitFactor: safeRatio(grossProfit, grossLoss),
      payoffRatio: safeRatio(avgWin, avgLoss),
      expectancy: normalizedTrades.length
        ? totalPnl / normalizedTrades.length
        : null,
      tradesPerDay:
        periodDays && periodDays > 0
          ? normalizedTrades.length / periodDays
          : null,
      tradesPerWeek:
        periodDays && periodDays > 0
          ? (normalizedTrades.length / periodDays) * 7
          : null,
    },
    risk: {
      maxDrawdown: drawdown.absolute,
      maxDrawdownPercent: drawdown.percent,
      maxDrawdownToTotalProfit:
        totalPnl > 0 ? safeRatio(drawdown.absolute, totalPnl) : null,
      maxDrawdownToGrossProfit:
        grossProfit > 0 ? safeRatio(drawdown.absolute, grossProfit) : null,
      recoveryFactor: safeRatio(totalPnl, drawdown.absolute),
      maxLossStreak: calculateLossStreak(normalizedTrades),
      losingMonthsCount: monthlyStats.filter(([, stat]) => stat.pnl < 0).length,
      worstMonthPnl: monthlyPnls.length ? Math.min(...monthlyPnls) : null,
      worstRolling30dPnl: calculateWorstRollingPnl(normalizedTrades, 30),
      worstRolling90dPnl: calculateWorstRollingPnl(normalizedTrades, 90),
    },
    stability: {
      monthlyWinRate: monthlyWinRates.length ? mean(monthlyWinRates) : null,
      positiveMonthsPercent: monthlyStats.length
        ? (positiveMonths / monthlyStats.length) * 100
        : null,
      quarterlyPnl: [...quarterly.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([quarter, pnl]) => ({ quarter, pnl })),
      rolling365Pnl:
        normalizedTrades.length && isFiniteMetric(lastTimestamp)
          ? normalizedTrades
              .filter(
                (trade) => lastTimestamp - trade.timestamp <= 365 * MS_IN_DAY,
              )
              .reduce((acc, trade) => acc + trade.pnl, 0)
          : null,
      medianMonthlyPnl: medianValue(monthlyPnls),
      iqrMonthlyPnl:
        p25Monthly === null || p75Monthly === null
          ? null
          : p75Monthly - p25Monthly,
      top5ProfitShare: sumTopPositiveProfitShare(pnls, 5),
      top10ProfitShare: sumTopPositiveProfitShare(pnls, 10),
    },
    distribution: {
      medianTrade: medianValue(pnls),
      p10Trade: percentile(pnls, 0.1),
      p25Trade: percentile(pnls, 0.25),
      p75Trade: percentile(pnls, 0.75),
      p90Trade: percentile(pnls, 0.9),
      largestWin: wins ? Math.max(...pnls.filter((pnl) => pnl > 0)) : null,
      largestLoss: losses ? Math.min(...pnls.filter((pnl) => pnl < 0)) : null,
      tailRatio: safeRatio(
        percentile(pnls, 0.95),
        Math.abs(percentile(pnls, 0.05) ?? 0),
      ),
      skewness: calculateSkewness(pnls),
    },
    riskAdjusted: {
      sharpeDaily:
        dailyMean !== null && dailyStd !== null && dailyStd > 0
          ? (dailyMean / dailyStd) * Math.sqrt(DAYS_IN_YEAR)
          : null,
      sortinoDaily:
        dailyMean !== null && downsideStd !== null && downsideStd > 0
          ? (dailyMean / downsideStd) * Math.sqrt(DAYS_IN_YEAR)
          : null,
      calmar: safeRatio(annualizedPnl, drawdown.absolute),
      mar: safeRatio(annualizedPnl, drawdown.absolute),
    },
    operational: {
      avgSlippageCost: slippageCosts.length ? mean(slippageCosts) : null,
      pnlBeforeSlippage: normalizedTrades.length ? pnlBeforeSlippage : null,
      pnlAfterSlippage: totalPnl,
      approvalRate: approvedFlags.length
        ? (approvedFlags.filter((trade) => trade.approved).length /
            approvedFlags.length) *
          100
        : null,
      blockedProfitableTrades: normalizedTrades.filter(
        (trade) => trade.blocked && trade.pnl > 0,
      ).length,
      approvedLosingTrades: normalizedTrades.filter(
        (trade) => trade.approved && trade.pnl < 0,
      ).length,
      symbolConcentrationTop1: concentrationPercent(
        normalizedTrades
          .filter((trade) => trade.symbol)
          .map((trade) => ({ key: String(trade.symbol), pnl: trade.pnl })),
        1,
      ),
      symbolConcentrationTop5: concentrationPercent(
        normalizedTrades
          .filter((trade) => trade.symbol)
          .map((trade) => ({ key: String(trade.symbol), pnl: trade.pnl })),
        5,
      ),
      sessionConcentrationTop1: concentrationPercent(
        normalizedTrades.map((trade) => ({
          key: trade.session ?? resolveTradeSession(trade.timestamp),
          pnl: trade.pnl,
        })),
        1,
      ),
      longTrades: directionStats.longTrades,
      shortTrades: directionStats.shortTrades,
      longPnl: directionStats.longPnl,
      shortPnl: directionStats.shortPnl,
    },
  };
};

/**
 * Считает помесячные доходности по equity на концах месяцев (EOM) и производные метрики.
 * Заполняет «пустые» месяцы переносом последнего известного amount (даёт 0% в такие месяцы).
 *
 * @param positionLogData Логи позиций (timestamps предполагаются в ms, если opts.tsUnit='ms')
 * @param opts.mar Минимально приемлемая доходность в месяц (MAR), доля. Часто берут 0.
 * @param opts.sampleStd Если true — выборочное std (деление на N-1), иначе population (деление на N).
 * @param opts.tsUnit 'ms' | 's' — единицы timestamps во входных данных.
 *
 * Возвращает:
 *  - eomSeries: массив точек конца месяцев с equity
 *  - monthlyReturns: ряд месячных ретёрнов r_t = EOM_t / EOM_{t-1} - 1 (доли)
 *  - monthlyMean, monthlyStd: арифм. среднее и std по месячной серии (population/sample)
 *  - monthlyDownsideStd: std ниже MAR (для Sortino)
 *  - sharpeMonthly, sharpeMonthlyAnnualized: месячный и годовой Sharpe по месячной серии
 *  - sortinoMonthly, sortinoMonthlyAnnualized: месячный и годовой Sortino по месячной серии
 *  - positiveMonths, maxMonthlyGain, maxMonthlyDrop: доп. характеристики ряда
 */
const computeMonthlyEquityStats = (
  positionLogData: PositionLogData,
  opts?: { mar?: number; sampleStd?: boolean; tsUnit?: 'ms' | 's' },
): MonthlyEquityStats => {
  const MAR = opts?.mar ?? 0;
  const useSample = !!opts?.sampleStd;
  const tsMul = (opts?.tsUnit ?? 'ms') === 's' ? 1000 : 1;

  if (!positionLogData.length) {
    return {
      eomSeries: [],
      monthlyReturns: [],
      monthlyMean: 0,
      monthlyStd: 0,
      monthlyDownsideStd: 0,
      sharpeMonthly: null,
      sharpeMonthlyAnnualized: null,
      sortinoMonthly: null,
      sortinoMonthlyAnnualized: null,
      positiveMonths: 0,
      maxMonthlyGain: 0,
      maxMonthlyDrop: 0,
    };
  }

  // 1) Строим точки equity (open/close) и сортируем по времени.
  //    Умножаем timestamps на tsMul, если исходно были секунды.
  const equityPoints = positionLogData
    .flatMap((p) => [
      { ts: p.open.timestamp * tsMul, amount: p.open.amount },
      { ts: p.close.timestamp * tsMul, amount: p.close.amount },
    ])
    .sort((a, b) => a.ts - b.ts);

  const startTs = equityPoints[0].ts;
  const endTs = equityPoints[equityPoints.length - 1].ts;

  // 2) EOM-ряд: для каждого конца месяца берём последний известный amount.
  //    Это даёт стабильный помесячный ряд даже при «дырах» между сделками.
  const eomSeries: EOMPoint[] = [];
  let monthCursor = startOfMonth(new Date(startTs));
  const lastMonth = endOfMonth(new Date(endTs));
  let i = 0;
  let lastAmount = equityPoints[0].amount;

  while (monthCursor <= lastMonth) {
    const eom = endOfMonth(monthCursor);
    const eomTs = eom.getTime();

    // Продвигаем индекс точек equity до конца месяца,
    // сохраняя последний встретившийся amount.
    while (i < equityPoints.length && equityPoints[i].ts <= eomTs) {
      lastAmount = equityPoints[i].amount;
      i += 1;
    }

    // Ключ месяца в формате YYYY-MM
    const key = `${eom.getFullYear()}-${String(eom.getMonth() + 1).padStart(2, '0')}`;
    eomSeries.push({ month: key, ts: eomTs, amount: lastAmount });
    monthCursor = addMonths(monthCursor, 1);
  }

  // 3) Месячные ретёрны: r_t = EOM_t / EOM_{t-1} - 1 (доли).
  const monthlyReturns: number[] = [];
  for (let k = 1; k < eomSeries.length; k++) {
    const prev = eomSeries[k - 1].amount;
    const curr = eomSeries[k].amount;
    monthlyReturns.push(prev > 0 ? curr / prev - 1 : 0);
  }

  // 4) Агрегаты по месячной серии: среднее, std (population/sample),
  //    downside std относительно MAR.
  const n = monthlyReturns.length;
  const monthlyMean = n ? monthlyReturns.reduce((a, b) => a + b, 0) / n : 0;

  const variance = n
    ? monthlyReturns.reduce((a, v) => a + (v - monthlyMean) ** 2, 0) /
      (useSample && n > 1 ? n - 1 : n)
    : 0;
  const monthlyStd = Math.sqrt(variance);

  // Downside-отклонения от MAR: берём только отрицательные части (r - MAR < 0).
  const downside = monthlyReturns
    .map((r) => Math.min(r - MAR, 0))
    .filter((v) => v < 0);
  const nd = downside.length;
  const downsideVar = nd
    ? downside.reduce((a, v) => a + v * v, 0) /
      (useSample && nd > 1 ? nd - 1 : nd)
    : 0;
  const monthlyDownsideStd = Math.sqrt(downsideVar);

  // Sharpe/Sortino по месячному ряду (в долях),
  // годовые версии масштабируются на sqrt(12).
  const sharpeMonthly =
    monthlyStd > 0 ? (monthlyMean - MAR) / monthlyStd : null;
  const sortinoMonthly =
    monthlyDownsideStd > 0 ? (monthlyMean - MAR) / monthlyDownsideStd : null;

  const sharpeMonthlyAnnualized =
    sharpeMonthly === null ? null : sharpeMonthly * Math.sqrt(12);
  const sortinoMonthlyAnnualized =
    sortinoMonthly === null ? null : sortinoMonthly * Math.sqrt(12);

  // Доп. характеристики помесячного ряда
  const positiveMonths = monthlyReturns.filter((r) => r > 0).length;
  const maxMonthlyGain = n ? Math.max(...monthlyReturns) : 0;
  const maxMonthlyDrop = n ? Math.min(...monthlyReturns) : 0;

  return {
    eomSeries,
    monthlyReturns,
    monthlyMean,
    monthlyStd,
    monthlyDownsideStd,
    sharpeMonthly,
    sharpeMonthlyAnnualized,
    sortinoMonthly,
    sortinoMonthlyAnnualized,
    positiveMonths,
    maxMonthlyGain,
    maxMonthlyDrop,
  };
};

/**
 * Рассчитывает компактный набор действительно полезных метрик:
 * - Период и частота (periodDays/Months, trades, tradesPerMonth, exposure)
 * - Доходность (final amount, netProfit, totalReturn %, CAGR %)
 * - Риск (MaxDD %) и Calmar (CAGR / MaxDD)
 * - Качество сделок (winRate %, payoff, expectancyPerTrade %, streaks)
 * - Sharpe (годовой) — по месячным ретёрнам equity (EOM)
 *
 * Возвратные проценты (totalReturn, cagr, exposure, maxDrawdown, expectancyPerTrade) — уже в %.
 * Шарп — безразмерная величина (annualized).
 */
export const calculateStatsFull = (
  positionLogData: PositionLogData,
): TestStat | null => {
  if (!positionLogData.length) return null;

  // Базовые ряды: абсолютные/относительные ретёрны на сделку и временной ряд equity.
  const retsAbs = absReturns(positionLogData);
  const retsRel = relReturns(positionLogData);
  const points = equityPoints(positionLogData);
  const startTs = points[0].ts;
  const endTs = points[points.length - 1].ts;

  // -------- Период и частота --------
  // Надёжная разница во времени с использованием date-fns
  const periodMs = differenceInMilliseconds(new Date(endTs), new Date(startTs));
  const periodDays = periodMs / (1000 * 60 * 60 * 24);
  const periodMonths = periodDays / 30.4375; // средняя длина календарного месяца
  const trades = positionLogData.length; // кол-во закрытых сделок
  const tradesPerMonth = periodMonths > 0 ? trades / periodMonths : 0;

  // Экспозиция: доля времени «в рынке» (сумма длительностей позиций / весь период).
  const durations = positionLogData.map(
    (p) => p.close.timestamp - p.open.timestamp,
  );
  const totalTime = endTs - startTs;
  const exposure = totalTime > 0 ? (sum(durations) / totalTime) * 100 : 0;

  // -------- Доходность --------
  const initialAmount = points[0].amount;
  const finalAmount = points[points.length - 1].amount;
  const netProfit = finalAmount - initialAmount;
  const totalReturn =
    initialAmount > 0 ? (finalAmount / initialAmount - 1) * 100 : 0;

  // CAGR — годовая геометрическая доходность из всего периода (в %).
  const cagr =
    periodMonths > 0 && initialAmount > 0
      ? (Math.pow(finalAmount / initialAmount, 12 / periodMonths) - 1) * 100
      : 0;

  // -------- Риск и Calmar --------
  const allAmounts = points.map((p) => p.amount);
  // Предполагается, что calculateMaxDrawdown возвращает %.
  const maxDrawdown = calculateMaxDrawdown(allAmounts);
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : null;

  // -------- Качество сделок --------
  const wins = retsAbs.filter((x) => x > 0).length;
  const losses = retsAbs.filter((x) => x <= 0).length;
  const winRate = trades ? (wins / trades) * 100 : 0;

  // Payoff = средний выигрыш / средний проигрыш (в абсолютном выражении, напр. $).
  const avgWinAbs = mean(retsAbs.filter((x) => x > 0));
  const avgLossAbs = Math.abs(mean(retsAbs.filter((x) => x < 0)));
  const payoff = avgLossAbs > 0 ? avgWinAbs / avgLossAbs : null;

  // Ожидаемая доходность на сделку (в %) из относительных ретёрнов:
  // E[r] = p(win)*avg_win_rel - p(loss)*avg_loss_rel
  const avgWinRel = mean(retsRel.filter((x) => x > 0)); // доли
  const avgLossRel = Math.abs(mean(retsRel.filter((x) => x < 0))); // доли
  const pWin = trades ? wins / trades : 0;
  const expectancyPerTrade = (pWin * avgWinRel - (1 - pWin) * avgLossRel) * 100;

  // Стрики
  const { maxConsecutiveWins, maxConsecutiveLosses } = calcStreaks(retsAbs);

  // -------- Sharpe (временной) --------
  // Берём месячные ретёрны по equity (EOM), считаем месячный Sharpe и масштабируем к годовому.
  const monthly = computeMonthlyEquityStats(positionLogData, {
    mar: 0, // MAR=0, при желании можно параметризовать
    sampleStd: false, // population std
    tsUnit: 'ms', // timestamps в миллисекундах
  });
  const sharpe =
    (monthly.sharpeMonthly ?? null) !== null
      ? monthly.sharpeMonthly! * Math.sqrt(12)
      : null;

  // -------- Результат --------
  const res = {
    // Период и частота
    periodDays: round(periodDays),
    periodMonths: round(periodMonths),
    orders: trades,
    wins,
    losses,
    ordersPerMonth: round(tradesPerMonth),
    exposure: round(exposure),

    // Доходность
    amount: round(finalAmount),
    maxAmount: round(Math.max(...allAmounts)),
    minAmount: round(Math.min(...allAmounts)),
    netProfit: round(netProfit),
    totalReturn: round(totalReturn),
    cagr: round(cagr),

    // Риск и Calmar
    maxDrawdown: round(maxDrawdown),
    calmar: calmar === null ? null : round(calmar),

    // Качество сделок
    winRate: round(winRate),
    riskRewardRatio: payoff === null ? null : round(payoff),
    expectancy: round(expectancyPerTrade),
    maxConsecutiveWins,
    maxConsecutiveLosses,

    // Sharpe (годовой) по месячным ретёрнам equity
    sharpeRatio: sharpe === null ? null : round(sharpe),
  };

  const score = getBacktestScore(res);

  return {
    ...res,
    score,
  };
};

export const classifyMetric = (
  name: TestThresholdsKey,
  value: number,
): ThresholdLevel => {
  const { thresholds, direction, neutralValue } = TestThresholdsConfig[name];

  if (neutralValue !== undefined && value === neutralValue) {
    return 'neutral';
  }

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
  if (!stat) {
    return 0;
  }

  const netProfit = Number(stat.netProfit ?? 0);
  const winRate = Number(stat.winRate ?? 0);

  if (!Number.isFinite(netProfit) || !Number.isFinite(winRate)) {
    return 0;
  }

  return Math.round(netProfit * winRate);
};

export const sortBestTests = (
  results: TestWorkerResult[],
  limit: number = 5,
): TestWorkerResult[] => {
  return results
    .sort((a, b) => (b.stat.amount ?? 0) - (a.stat.amount ?? 0))
    .slice(0, limit);
};

export const getFormatted = (
  stat: Partial<TestStat> | undefined,
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
