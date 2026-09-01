import { addMonths, endOfMonth, startOfMonth } from 'date-fns';
import type {
  RuntimeStrategyTradeSummary,
  RuntimeStrategyTradeView,
  RuntimeTradeRecord,
  SimpleOrderLogData,
  TestStat,
} from '@tradejs/types';
import { INITIAL_BACKTEST_AMOUNT } from '#constants';
import {
  normalizeStrategyOrderLinkKey,
  parseStrategyOrderLinkKey,
} from '../trade';

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const AVG_DAYS_IN_MONTH = 30.4375;

type ResolvedRuntimeTrade = RuntimeTradeRecord & {
  resolvedPnl: number;
  resolvedTimestamp: number;
};

const roundValue = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toFiniteNumberOrNull = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const getTradePnl = (trade: RuntimeTradeRecord) =>
  trade.status === 'closed'
    ? trade.closedPnl ?? trade.currentPnl ?? null
    : trade.currentPnl ?? null;

const getTradeResolvedTimestamp = (
  trade: RuntimeTradeRecord,
  endTime: number,
) =>
  typeof trade.exitTimestamp === 'number' &&
  Number.isFinite(trade.exitTimestamp)
    ? trade.exitTimestamp
    : endTime;

const resolveTradesWithKnownPnl = (
  trades: RuntimeTradeRecord[],
  endTime: number,
): ResolvedRuntimeTrade[] =>
  trades
    .map((trade) => {
      const resolvedPnl = getTradePnl(trade);
      const resolvedTimestamp = getTradeResolvedTimestamp(trade, endTime);
      if (
        typeof resolvedPnl !== 'number' ||
        !Number.isFinite(resolvedPnl) ||
        !Number.isFinite(resolvedTimestamp)
      ) {
        return null;
      }
      return {
        ...trade,
        resolvedPnl,
        resolvedTimestamp: Math.max(trade.entryTimestamp, resolvedTimestamp),
      };
    })
    .filter((trade): trade is ResolvedRuntimeTrade => trade != null)
    .sort(
      (left, right) =>
        left.resolvedTimestamp - right.resolvedTimestamp ||
        left.entryTimestamp - right.entryTimestamp,
    );

const calculateMaxDrawdown = (amounts: number[]) => {
  let peak = amounts[0] ?? 0;
  let maxDrawdown = 0;
  for (const amount of amounts) {
    peak = Math.max(peak, amount);
    if (peak > 0) {
      maxDrawdown = Math.max(maxDrawdown, ((peak - amount) / peak) * 100);
    }
  }
  return roundValue(maxDrawdown);
};

const calculateSharpeRatio = (
  orderLog: SimpleOrderLogData,
  startTime: number,
  endTime: number,
) => {
  if (!orderLog.length || endTime <= startTime) return null;
  const points = [...orderLog]
    .map(([ts, amount]) => ({ ts, amount }))
    .sort((left, right) => left.ts - right.ts);
  const eomSeries: number[] = [];
  let pointIndex = 0;
  let monthCursor = startOfMonth(new Date(startTime));
  const lastMonth = endOfMonth(new Date(endTime));
  let lastAmount = points[0]?.amount ?? INITIAL_BACKTEST_AMOUNT;

  while (monthCursor <= lastMonth) {
    const eomTs = endOfMonth(monthCursor).getTime();
    while (pointIndex < points.length && points[pointIndex].ts <= eomTs) {
      lastAmount = points[pointIndex].amount;
      pointIndex += 1;
    }
    eomSeries.push(lastAmount);
    monthCursor = addMonths(monthCursor, 1);
  }
  if (eomSeries.length < 2) return null;
  const monthlyReturns = eomSeries.slice(1).map((amount, index) => {
    const previous = eomSeries[index];
    return previous > 0 ? amount / previous - 1 : 0;
  });
  const mean =
    monthlyReturns.reduce((sum, value) => sum + value, 0) /
    monthlyReturns.length;
  const variance =
    monthlyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    monthlyReturns.length;
  const standardDeviation = Math.sqrt(variance);
  return standardDeviation > 0 && Number.isFinite(standardDeviation)
    ? roundValue((mean / standardDeviation) * Math.sqrt(12))
    : null;
};

const calculateExposurePercent = (
  trades: RuntimeTradeRecord[],
  startTime: number,
  endTime: number,
) => {
  if (endTime <= startTime) return 0;
  const intervals = trades
    .map((trade) => ({
      start: Math.max(startTime, trade.entryTimestamp),
      end: Math.min(endTime, getTradeResolvedTimestamp(trade, endTime)),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
    } else {
      last.end = Math.max(last.end, interval.end);
    }
  }
  const coveredMs = merged.reduce(
    (sum, interval) => sum + interval.end - interval.start,
    0,
  );
  return roundValue((coveredMs / (endTime - startTime)) * 100);
};

const calculateStreaks = (pnls: number[]) => {
  let currentWins = 0;
  let currentLosses = 0;
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  for (const pnl of pnls) {
    if (pnl > 0) {
      currentWins += 1;
      currentLosses = 0;
    } else if (pnl < 0) {
      currentLosses += 1;
      currentWins = 0;
    } else {
      currentWins = 0;
      currentLosses = 0;
    }
    maxConsecutiveWins = Math.max(maxConsecutiveWins, currentWins);
    maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentLosses);
  }
  return { maxConsecutiveWins, maxConsecutiveLosses };
};

const calculateSymbolConcentration = (
  trades: ResolvedRuntimeTrade[],
  limit: number,
) => {
  const pnlBySymbol = new Map<string, number>();
  for (const trade of trades) {
    pnlBySymbol.set(
      trade.symbol,
      (pnlBySymbol.get(trade.symbol) ?? 0) + Math.abs(trade.resolvedPnl),
    );
  }
  const values = [...pnlBySymbol.values()].sort((left, right) => right - left);
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0
    ? roundValue(
        (values.slice(0, limit).reduce((sum, value) => sum + value, 0) /
          total) *
          100,
      )
    : null;
};

const createEmptyStat = (startTime: number, endTime: number): TestStat => {
  const periodDays = Math.max(0, (endTime - startTime) / MS_IN_DAY);
  return {
    periodDays: roundValue(periodDays),
    periodMonths: roundValue(periodDays / AVG_DAYS_IN_MONTH),
    orders: 0,
    wins: 0,
    losses: 0,
    ordersPerMonth: 0,
    exposure: 0,
    amount: INITIAL_BACKTEST_AMOUNT,
    maxAmount: INITIAL_BACKTEST_AMOUNT,
    minAmount: INITIAL_BACKTEST_AMOUNT,
    netProfit: 0,
    totalReturn: 0,
    cagr: 0,
    maxDrawdown: 0,
    calmar: null,
    winRate: 0,
    riskRewardRatio: null,
    expectancy: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    sharpeRatio: null,
    score: 0,
  };
};

export const resolveStrategyNameByOrderLinkId = ({
  orderLinkId,
  strategyNames,
}: {
  orderLinkId: string | null | undefined;
  strategyNames: string[];
}) => {
  const strategyKey = parseStrategyOrderLinkKey(orderLinkId);
  if (!strategyKey) return null;
  const strategyByKey = new Map<string, string>();
  for (const strategyName of strategyNames) {
    const key = normalizeStrategyOrderLinkKey(strategyName);
    if (key && !strategyByKey.has(key)) strategyByKey.set(key, strategyName);
  }
  return strategyByKey.get(strategyKey) ?? null;
};

export const isRuntimeTradeRecord = (
  value: unknown,
): value is RuntimeTradeRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.orderId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.entryTimestamp === 'number' &&
    typeof record.entryPrice === 'number' &&
    typeof record.qty === 'number'
  );
};

export const selectTradesForWindow = (
  trades: RuntimeTradeRecord[],
  startTime: number,
  activeOrderIds: Set<string> = new Set(),
) =>
  trades.filter((trade) => {
    if (trade.status === 'active') {
      return (
        activeOrderIds.has(trade.orderId) || trade.entryTimestamp >= startTime
      );
    }
    return (
      trade.entryTimestamp >= startTime ||
      (typeof trade.exitTimestamp === 'number' &&
        trade.exitTimestamp >= startTime)
    );
  });

export const buildRuntimeStrategyAnalytics = ({
  trades,
  startTime,
  endTime,
}: {
  trades: RuntimeTradeRecord[];
  startTime: number;
  endTime: number;
}) => {
  const activeTrades = trades.filter(({ status }) => status === 'active');
  const closedTrades = trades.filter(({ status }) => status === 'closed');
  const resolvedTrades = resolveTradesWithKnownPnl(closedTrades, endTime);
  const orderLog: SimpleOrderLogData = [[startTime, INITIAL_BACKTEST_AMOUNT]];
  let runningAmount = INITIAL_BACKTEST_AMOUNT;
  for (const trade of resolvedTrades) {
    runningAmount = roundValue(runningAmount + trade.resolvedPnl);
    orderLog.push([trade.resolvedTimestamp, runningAmount]);
  }
  if (orderLog[orderLog.length - 1]?.[0] !== endTime) {
    orderLog.push([endTime, runningAmount]);
  }

  const pnls = resolvedTrades.map(({ resolvedPnl }) => resolvedPnl);
  const wins = pnls.filter((pnl) => pnl > 0).length;
  const losses = pnls.filter((pnl) => pnl < 0).length;
  const averageWin = wins
    ? pnls.filter((pnl) => pnl > 0).reduce((sum, pnl) => sum + pnl, 0) / wins
    : 0;
  const averageLoss = losses
    ? Math.abs(
        pnls.filter((pnl) => pnl < 0).reduce((sum, pnl) => sum + pnl, 0) /
          losses,
      )
    : 0;
  let amountBeforeTrade = INITIAL_BACKTEST_AMOUNT;
  const returnSeries = resolvedTrades.map((trade) => {
    const value =
      amountBeforeTrade > 0 ? trade.resolvedPnl / amountBeforeTrade : 0;
    amountBeforeTrade += trade.resolvedPnl;
    return value;
  });
  const periodDays = Math.max(0, (endTime - startTime) / MS_IN_DAY);
  const periodMonths = periodDays / AVG_DAYS_IN_MONTH;
  const amount = orderLog[orderLog.length - 1]?.[1] ?? INITIAL_BACKTEST_AMOUNT;
  const netProfit = amount - INITIAL_BACKTEST_AMOUNT;
  const totalReturn = (netProfit / INITIAL_BACKTEST_AMOUNT) * 100;
  const cagr =
    periodMonths > 0
      ? (Math.pow(amount / INITIAL_BACKTEST_AMOUNT, 12 / periodMonths) - 1) *
        100
      : 0;
  const amounts = orderLog.map(([, value]) => value);
  const maxDrawdown = calculateMaxDrawdown(amounts);
  const streaks = calculateStreaks(pnls);

  const stat: TestStat = closedTrades.length
    ? {
        periodDays: roundValue(periodDays),
        periodMonths: roundValue(periodMonths),
        orders: closedTrades.length,
        wins,
        losses,
        ordersPerMonth: periodMonths
          ? roundValue(closedTrades.length / periodMonths)
          : 0,
        exposure: calculateExposurePercent(closedTrades, startTime, endTime),
        amount: roundValue(amount),
        maxAmount: roundValue(Math.max(...amounts)),
        minAmount: roundValue(Math.min(...amounts)),
        netProfit: roundValue(netProfit),
        totalReturn: roundValue(totalReturn),
        cagr: roundValue(cagr),
        maxDrawdown,
        calmar: maxDrawdown > 0 ? roundValue(cagr / maxDrawdown) : null,
        winRate: roundValue((wins / closedTrades.length) * 100),
        riskRewardRatio:
          averageLoss > 0 ? roundValue(averageWin / averageLoss) : null,
        expectancy: returnSeries.length
          ? roundValue(
              (returnSeries.reduce((sum, value) => sum + value, 0) /
                returnSeries.length) *
                100,
            )
          : 0,
        ...streaks,
        sharpeRatio: calculateSharpeRatio(orderLog, startTime, endTime),
        score: 0,
      }
    : createEmptyStat(startTime, endTime);

  const sumPnl = (
    rows: RuntimeTradeRecord[],
    primary: 'currentPnl' | 'closedPnl',
  ) =>
    roundValue(
      rows.reduce((sum, trade) => {
        const value = trade[primary] ?? trade.currentPnl;
        return (
          sum +
          (typeof value === 'number' && Number.isFinite(value) ? value : 0)
        );
      }, 0),
    );
  const activePnl = sumPnl(activeTrades, 'currentPnl');
  const closedPnl = sumPnl(closedTrades, 'closedPnl');
  const summary: RuntimeStrategyTradeSummary = {
    totalTrades: trades.length,
    activeTrades: activeTrades.length,
    closedTrades: closedTrades.length,
    wins,
    losses,
    activePnl,
    closedPnl,
    totalPnl: roundValue(activePnl + closedPnl),
    symbolConcentrationTop1: calculateSymbolConcentration(resolvedTrades, 1),
    symbolConcentrationTop5: calculateSymbolConcentration(resolvedTrades, 5),
  };
  return { orderLog, stat, summary };
};

const getLevelPercent = (
  trade: RuntimeTradeRecord,
  levelPrice: unknown,
  kind: 'takeProfit' | 'stopLoss',
) => {
  if (
    typeof levelPrice !== 'number' ||
    !Number.isFinite(levelPrice) ||
    !Number.isFinite(trade.entryPrice) ||
    trade.entryPrice <= 0
  ) {
    return null;
  }
  const raw =
    trade.direction === 'LONG'
      ? ((levelPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - levelPrice) / trade.entryPrice) * 100;
  return roundValue(kind === 'stopLoss' ? Math.abs(raw) : raw);
};

const getSlippagePercent = (expectedPrice: unknown, actualPrice: unknown) =>
  typeof expectedPrice === 'number' &&
  Number.isFinite(expectedPrice) &&
  expectedPrice > 0 &&
  typeof actualPrice === 'number' &&
  Number.isFinite(actualPrice)
    ? roundValue(((actualPrice - expectedPrice) / expectedPrice) * 100, 4)
    : null;

const getTotalFee = (trade: RuntimeTradeRecord) => {
  const explicit = toFiniteNumberOrNull(trade.totalFee);
  if (explicit != null) return explicit;
  const fees = [trade.openFee, trade.closeFee, trade.fundingFee]
    .map(toFiniteNumberOrNull)
    .filter((value): value is number => value != null);
  return fees.length
    ? Number(fees.reduce((sum, value) => sum + value, 0).toFixed(12))
    : null;
};

export const toRuntimeTradeView = (
  trade: RuntimeTradeRecord,
  endTime = Date.now(),
): RuntimeStrategyTradeView => {
  const resolvedTimestamp = getTradeResolvedTimestamp(trade, endTime);
  const durationHours =
    Number.isFinite(resolvedTimestamp) &&
    resolvedTimestamp >= trade.entryTimestamp
      ? roundValue((resolvedTimestamp - trade.entryTimestamp) / 3_600_000)
      : null;
  const expectedExitPrice =
    trade.exitType === 'tp'
      ? trade.aiAnalysis?.takeProfitPrice
      : trade.exitType === 'sl'
        ? trade.aiAnalysis?.stopLossPrice
        : null;
  return {
    orderId: trade.orderId,
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status,
    qty: trade.qty,
    entryTimestamp: trade.entryTimestamp,
    entryPrice: trade.entryPrice,
    actualEntryPrice: toFiniteNumberOrNull(trade.actualEntryPrice),
    exitTimestamp: toFiniteNumberOrNull(trade.exitTimestamp),
    exitPrice: toFiniteNumberOrNull(trade.exitPrice),
    actualExitPrice: toFiniteNumberOrNull(trade.actualExitPrice),
    currentPrice: toFiniteNumberOrNull(trade.currentPrice),
    pnl: getTradePnl(trade),
    durationHours,
    entrySlippagePercent: getSlippagePercent(
      trade.entryPrice,
      trade.actualEntryPrice,
    ),
    exitSlippagePercent: getSlippagePercent(
      expectedExitPrice,
      trade.actualExitPrice ?? trade.exitPrice,
    ),
    exitType: trade.exitType ?? null,
    takeProfitPrice: toFiniteNumberOrNull(trade.aiAnalysis?.takeProfitPrice),
    stopLossPrice: toFiniteNumberOrNull(trade.aiAnalysis?.stopLossPrice),
    takeProfitPercent: getLevelPercent(
      trade,
      trade.aiAnalysis?.takeProfitPrice,
      'takeProfit',
    ),
    stopLossPercent: getLevelPercent(
      trade,
      trade.aiAnalysis?.stopLossPrice,
      'stopLoss',
    ),
    openFee: toFiniteNumberOrNull(trade.openFee),
    closeFee: toFiniteNumberOrNull(trade.closeFee),
    fundingFee: toFiniteNumberOrNull(trade.fundingFee),
    totalFee: getTotalFee(trade),
    lastSyncedAt: toFiniteNumberOrNull(trade.lastSyncedAt),
  };
};
