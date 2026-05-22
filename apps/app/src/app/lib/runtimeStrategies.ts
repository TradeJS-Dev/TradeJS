import { endOfMonth, addMonths, startOfMonth } from 'date-fns';
import { INITIAL_BACKTEST_AMOUNT } from '@tradejs/core/constants';
import {
  normalizeStrategyOrderLinkKey,
  parseStrategyOrderLinkKey,
} from '@tradejs/core/trade';
import type {
  ClosedPnlRecord,
  ExchangeEntryRecord,
  PositionPnlSnapshot,
  RuntimeTradeRecord,
  SimpleOrderLogData,
  TestStat,
} from '@tradejs/types';

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const AVG_DAYS_IN_MONTH = 30.4375;

type ClosedPnlRecordWithOrderLinkId = ClosedPnlRecord & {
  orderLinkId?: string;
};

type RuntimeTradeWithResolvedPnl = RuntimeTradeRecord & {
  resolvedPnl: number;
  resolvedTimestamp: number;
};

export interface RuntimeStrategyTradeSummary {
  totalTrades: number;
  activeTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  activePnl: number;
  closedPnl: number;
  totalPnl: number;
}

export interface RuntimeStrategyTradeView {
  orderId: string;
  symbol: string;
  direction: RuntimeTradeRecord['direction'];
  status: RuntimeTradeRecord['status'];
  entryTimestamp: number;
  entryPrice: number;
  exitTimestamp: number | null;
  exitPrice: number | null;
  pnl: number | null;
  lastSyncedAt: number | null;
}

export interface RuntimeStrategyView {
  strategyName: string;
  connected: boolean;
  symbols: string[];
  stat: TestStat;
  summary: RuntimeStrategyTradeSummary;
  orderLog: SimpleOrderLogData;
  recentTrades: RuntimeStrategyTradeView[];
}

export interface RuntimeStrategiesResponse {
  provider: string;
  hours: number;
  generatedAt: number;
  strategies: RuntimeStrategyView[];
}

const roundValue = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const getTradePnl = (trade: RuntimeTradeRecord) =>
  trade.status === 'closed'
    ? trade.closedPnl ?? trade.currentPnl ?? null
    : trade.currentPnl ?? null;

const getTradeResolvedTimestamp = (
  trade: RuntimeTradeRecord,
  endTime: number,
) => {
  if (
    typeof trade.exitTimestamp === 'number' &&
    Number.isFinite(trade.exitTimestamp)
  ) {
    return trade.exitTimestamp;
  }

  return endTime;
};

const resolveTradesWithKnownPnl = (
  trades: RuntimeTradeRecord[],
  endTime: number,
): RuntimeTradeWithResolvedPnl[] =>
  trades
    .map((trade) => {
      const pnl = getTradePnl(trade);
      const resolvedTimestamp = getTradeResolvedTimestamp(trade, endTime);

      if (
        typeof pnl !== 'number' ||
        !Number.isFinite(pnl) ||
        !Number.isFinite(resolvedTimestamp)
      ) {
        return null;
      }

      return {
        ...trade,
        resolvedPnl: pnl,
        resolvedTimestamp: Math.max(trade.entryTimestamp, resolvedTimestamp),
      };
    })
    .filter((trade): trade is RuntimeTradeWithResolvedPnl => trade != null)
    .sort((left, right) => {
      if (left.resolvedTimestamp !== right.resolvedTimestamp) {
        return left.resolvedTimestamp - right.resolvedTimestamp;
      }

      return left.entryTimestamp - right.entryTimestamp;
    });

const calculateMaxDrawdown = (amounts: number[]) => {
  if (!amounts.length) {
    return 0;
  }

  let peak = amounts[0];
  let maxDrawdown = 0;

  for (const amount of amounts) {
    if (amount > peak) {
      peak = amount;
    }

    if (peak <= 0) {
      continue;
    }

    const drawdown = ((peak - amount) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return roundValue(maxDrawdown);
};

const calculateSharpeRatio = (
  orderLog: SimpleOrderLogData,
  startTime: number,
  endTime: number,
) => {
  if (!orderLog.length || endTime <= startTime) {
    return null;
  }

  const points = [...orderLog]
    .map(([timestamp, amount]) => ({ ts: timestamp, amount }))
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

  if (eomSeries.length < 2) {
    return null;
  }

  const monthlyReturns: number[] = [];
  for (let index = 1; index < eomSeries.length; index += 1) {
    const previous = eomSeries[index - 1];
    const current = eomSeries[index];
    monthlyReturns.push(previous > 0 ? current / previous - 1 : 0);
  }

  if (!monthlyReturns.length) {
    return null;
  }

  const mean =
    monthlyReturns.reduce((sum, value) => sum + value, 0) /
    monthlyReturns.length;
  const variance =
    monthlyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    monthlyReturns.length;
  const std = Math.sqrt(variance);

  if (!Number.isFinite(std) || std === 0) {
    return null;
  }

  return roundValue((mean / std) * Math.sqrt(12));
};

const calculateExposurePercent = (
  trades: RuntimeTradeRecord[],
  startTime: number,
  endTime: number,
) => {
  if (endTime <= startTime) {
    return 0;
  }

  const intervals = trades
    .map((trade) => ({
      start: Math.max(startTime, trade.entryTimestamp),
      end: Math.min(endTime, getTradeResolvedTimestamp(trade, endTime)),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);

  if (!intervals.length) {
    return 0;
  }

  const merged: Array<{ start: number; end: number }> = [];

  for (const interval of intervals) {
    const last = merged[merged.length - 1];

    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      continue;
    }

    last.end = Math.max(last.end, interval.end);
  }

  const coveredMs = merged.reduce(
    (sum, interval) => sum + (interval.end - interval.start),
    0,
  );

  return roundValue((coveredMs / (endTime - startTime)) * 100);
};

const calculateStreaks = (pnls: number[]) => {
  let currentWins = 0;
  let currentLosses = 0;
  let maxWins = 0;
  let maxLosses = 0;

  for (const pnl of pnls) {
    if (pnl > 0) {
      currentWins += 1;
      currentLosses = 0;
      maxWins = Math.max(maxWins, currentWins);
      continue;
    }

    if (pnl < 0) {
      currentLosses += 1;
      currentWins = 0;
      maxLosses = Math.max(maxLosses, currentLosses);
      continue;
    }

    currentWins = 0;
    currentLosses = 0;
  }

  return {
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses,
  };
};

const createEmptyRuntimeStat = (
  startTime: number,
  endTime: number,
): TestStat => {
  const periodDays = Math.max(0, (endTime - startTime) / MS_IN_DAY);
  const periodMonths = periodDays / AVG_DAYS_IN_MONTH;

  return {
    periodDays: roundValue(periodDays),
    periodMonths: roundValue(periodMonths),
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

export const resolveStrategyNameByConfigKey = (
  userName: string,
  key: string,
): string | null => {
  const prefix = `users:${userName}:strategies:`;

  if (!key.startsWith(prefix) || !key.endsWith(':config')) {
    return null;
  }

  const strategyName = key.slice(prefix.length, -':config'.length).trim();
  return strategyName || null;
};

const buildStrategyNameKeyMap = (strategyNames: string[]) => {
  const map = new Map<string, string>();

  for (const strategyName of strategyNames) {
    const key = normalizeStrategyOrderLinkKey(strategyName);

    if (key && !map.has(key)) {
      map.set(key, strategyName);
    }
  }

  return map;
};

export const resolveStrategyNameByOrderLinkId = ({
  orderLinkId,
  strategyNames,
}: {
  orderLinkId: string | null | undefined;
  strategyNames: string[];
}) => {
  const strategyKey = parseStrategyOrderLinkKey(orderLinkId);

  if (!strategyKey) {
    return null;
  }

  return buildStrategyNameKeyMap(strategyNames).get(strategyKey) ?? null;
};

export const isRuntimeTradeRecord = (
  value: unknown,
): value is RuntimeTradeRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

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
      if (activeOrderIds.has(trade.orderId)) {
        return true;
      }

      return trade.entryTimestamp >= startTime;
    }

    const exitTimestamp =
      typeof trade.exitTimestamp === 'number' ? trade.exitTimestamp : 0;

    return trade.entryTimestamp >= startTime || exitTimestamp >= startTime;
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
  const resolvedTrades = resolveTradesWithKnownPnl(trades, endTime);
  const orderLog: SimpleOrderLogData = [[startTime, INITIAL_BACKTEST_AMOUNT]];
  const tradePnls = resolvedTrades.map((trade) => trade.resolvedPnl);
  let runningAmount = INITIAL_BACKTEST_AMOUNT;

  for (const trade of resolvedTrades) {
    runningAmount = roundValue(runningAmount + trade.resolvedPnl);
    orderLog.push([trade.resolvedTimestamp, runningAmount]);
  }

  if (orderLog[orderLog.length - 1]?.[0] !== endTime) {
    orderLog.push([endTime, runningAmount]);
  }

  const amounts = orderLog.map(([, amount]) => amount);
  const wins = tradePnls.filter((pnl) => pnl > 0).length;
  const losses = tradePnls.filter((pnl) => pnl < 0).length;
  const averageWin =
    wins > 0
      ? tradePnls.filter((pnl) => pnl > 0).reduce((sum, pnl) => sum + pnl, 0) /
        wins
      : 0;
  const averageLossAbs =
    losses > 0
      ? Math.abs(
          tradePnls
            .filter((pnl) => pnl < 0)
            .reduce((sum, pnl) => sum + pnl, 0) / losses,
        )
      : 0;
  const returnSeries: number[] = [];
  let amountBeforeTrade = INITIAL_BACKTEST_AMOUNT;

  for (const trade of resolvedTrades) {
    returnSeries.push(
      amountBeforeTrade > 0 ? trade.resolvedPnl / amountBeforeTrade : 0,
    );
    amountBeforeTrade += trade.resolvedPnl;
  }

  const periodDays = Math.max(0, (endTime - startTime) / MS_IN_DAY);
  const periodMonths = periodDays / AVG_DAYS_IN_MONTH;
  const amount = amounts[amounts.length - 1] ?? INITIAL_BACKTEST_AMOUNT;
  const netProfit = amount - INITIAL_BACKTEST_AMOUNT;
  const totalReturn =
    INITIAL_BACKTEST_AMOUNT > 0
      ? ((amount - INITIAL_BACKTEST_AMOUNT) / INITIAL_BACKTEST_AMOUNT) * 100
      : 0;
  const cagr =
    periodMonths > 0
      ? (Math.pow(amount / INITIAL_BACKTEST_AMOUNT, 12 / periodMonths) - 1) *
        100
      : 0;
  const maxDrawdown = calculateMaxDrawdown(amounts);
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : null;
  const riskRewardRatio =
    averageLossAbs > 0 ? averageWin / averageLossAbs : null;
  const expectancy =
    returnSeries.length > 0
      ? roundValue(
          (returnSeries.reduce((sum, value) => sum + value, 0) /
            returnSeries.length) *
            100,
        )
      : 0;
  const sharpeRatio = calculateSharpeRatio(orderLog, startTime, endTime);
  const exposure = calculateExposurePercent(trades, startTime, endTime);
  const { maxConsecutiveWins, maxConsecutiveLosses } =
    calculateStreaks(tradePnls);

  const stat: TestStat =
    trades.length === 0
      ? createEmptyRuntimeStat(startTime, endTime)
      : {
          periodDays: roundValue(periodDays),
          periodMonths: roundValue(periodMonths),
          orders: trades.length,
          wins,
          losses,
          ordersPerMonth:
            periodMonths > 0 ? roundValue(trades.length / periodMonths) : 0,
          exposure,
          amount: roundValue(amount),
          maxAmount: roundValue(Math.max(...amounts)),
          minAmount: roundValue(Math.min(...amounts)),
          netProfit: roundValue(netProfit),
          totalReturn: roundValue(totalReturn),
          cagr: roundValue(cagr),
          maxDrawdown,
          calmar: calmar == null ? null : roundValue(calmar),
          winRate:
            trades.length > 0 ? roundValue((wins / trades.length) * 100) : 0,
          riskRewardRatio:
            riskRewardRatio == null ? null : roundValue(riskRewardRatio),
          expectancy,
          maxConsecutiveWins,
          maxConsecutiveLosses,
          sharpeRatio,
          score: 0,
        };

  const activeTrades = trades.filter((trade) => trade.status === 'active');
  const closedTrades = trades.filter((trade) => trade.status === 'closed');
  const activePnl = roundValue(
    activeTrades.reduce(
      (sum, trade) =>
        sum +
        (typeof trade.currentPnl === 'number' &&
        Number.isFinite(trade.currentPnl)
          ? trade.currentPnl
          : 0),
      0,
    ),
  );
  const closedPnl = roundValue(
    closedTrades.reduce(
      (sum, trade) =>
        sum +
        (typeof trade.closedPnl === 'number' && Number.isFinite(trade.closedPnl)
          ? trade.closedPnl
          : typeof trade.currentPnl === 'number' &&
              Number.isFinite(trade.currentPnl)
            ? trade.currentPnl
            : 0),
      0,
    ),
  );

  return {
    orderLog,
    stat,
    summary: {
      totalTrades: trades.length,
      activeTrades: activeTrades.length,
      closedTrades: closedTrades.length,
      wins,
      losses,
      activePnl,
      closedPnl,
      totalPnl: roundValue(activePnl + closedPnl),
    },
  };
};

export const toRuntimeTradeView = (
  trade: RuntimeTradeRecord,
): RuntimeStrategyTradeView => ({
  orderId: trade.orderId,
  symbol: trade.symbol,
  direction: trade.direction,
  status: trade.status,
  entryTimestamp: trade.entryTimestamp,
  entryPrice: trade.entryPrice,
  exitTimestamp:
    typeof trade.exitTimestamp === 'number' ? trade.exitTimestamp : null,
  exitPrice: typeof trade.exitPrice === 'number' ? trade.exitPrice : null,
  pnl: getTradePnl(trade),
  lastSyncedAt:
    typeof trade.lastSyncedAt === 'number' ? trade.lastSyncedAt : null,
});

const removeClosedPnlFromExactMaps = ({
  exactByOrderLinkId,
  exactByOrderId,
  row,
}: {
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  exactByOrderId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  row: ClosedPnlRecordWithOrderLinkId;
}) => {
  if (row.orderLinkId) {
    exactByOrderLinkId.delete(row.orderLinkId);
  }

  if (row.orderId) {
    exactByOrderId.delete(row.orderId);
  }
};

const removeClosedPnlFromSymbolBuckets = (
  buckets: Map<string, ClosedPnlRecordWithOrderLinkId[]>,
  row: ClosedPnlRecordWithOrderLinkId,
) => {
  const rows = buckets.get(row.symbol);
  if (!rows?.length) {
    return;
  }

  const index = rows.findIndex((candidate) => candidate === row);
  if (index >= 0) {
    rows.splice(index, 1);
  }
};

const takeExactClosedPnlMatch = ({
  exactByOrderLinkId,
  exactByOrderId,
  symbolBuckets,
  orderLinkId,
  orderId,
}: {
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  exactByOrderId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  symbolBuckets: Map<string, ClosedPnlRecordWithOrderLinkId[]>;
  orderLinkId?: string | null;
  orderId?: string | null;
}) => {
  const exactKeys: Array<
    [Map<string, ClosedPnlRecordWithOrderLinkId>, string | null | undefined]
  > = [
    [exactByOrderLinkId, orderLinkId],
    [exactByOrderId, orderId],
  ];

  for (const [bucket, key] of exactKeys) {
    const normalizedKey = toNonEmptyString(key);

    if (!normalizedKey) {
      continue;
    }

    const exactMatch = bucket.get(normalizedKey);
    if (!exactMatch) {
      continue;
    }

    removeClosedPnlFromExactMaps({
      exactByOrderLinkId,
      exactByOrderId,
      row: exactMatch,
    });
    removeClosedPnlFromSymbolBuckets(symbolBuckets, exactMatch);
    return exactMatch;
  }

  return null;
};

export const takeClosedPnlMatch = ({
  exactByOrderLinkId,
  exactByOrderId = new Map<string, ClosedPnlRecordWithOrderLinkId>(),
  symbolBuckets,
  trade,
}: {
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  exactByOrderId?: Map<string, ClosedPnlRecordWithOrderLinkId>;
  symbolBuckets: Map<string, ClosedPnlRecordWithOrderLinkId[]>;
  trade: RuntimeTradeRecord;
}) => {
  const exactMatch = takeExactClosedPnlMatch({
    exactByOrderLinkId,
    exactByOrderId,
    symbolBuckets,
    orderLinkId: trade.orderId,
  });

  if (exactMatch) {
    return exactMatch;
  }

  const rows = symbolBuckets.get(trade.symbol);
  if (!rows?.length) {
    return null;
  }

  const minimumClosedAt = trade.entryTimestamp - 5 * 60_000;
  const matchIndex = rows.findIndex(
    (row) => Number.isFinite(row.closedAt) && row.closedAt >= minimumClosedAt,
  );

  if (matchIndex < 0) {
    return null;
  }

  const [row] = rows.splice(matchIndex, 1);
  if (row) {
    removeClosedPnlFromExactMaps({
      exactByOrderLinkId,
      exactByOrderId,
      row,
    });
  }

  return row ?? null;
};

const takeClosedPnlMatchForExchangeEntry = ({
  exactByOrderLinkId,
  exactByOrderId,
  symbolBuckets,
  entry,
}: {
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  exactByOrderId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  symbolBuckets: Map<string, ClosedPnlRecordWithOrderLinkId[]>;
  entry: ExchangeEntryRecord;
}) => {
  const exactMatch = takeExactClosedPnlMatch({
    exactByOrderLinkId,
    exactByOrderId,
    symbolBuckets,
    orderLinkId: entry.orderLinkId,
    orderId: entry.orderId,
  });

  if (exactMatch) {
    return exactMatch;
  }

  const rows = symbolBuckets.get(entry.symbol);
  if (!rows?.length) {
    return null;
  }

  const minimumClosedAt = entry.entryTimestamp - 5 * 60_000;
  const matchIndex = rows.findIndex(
    (row) => Number.isFinite(row.closedAt) && row.closedAt >= minimumClosedAt,
  );

  if (matchIndex < 0) {
    return null;
  }

  const [row] = rows.splice(matchIndex, 1);
  if (row) {
    removeClosedPnlFromExactMaps({
      exactByOrderLinkId,
      exactByOrderId,
      row,
    });
  }

  return row ?? null;
};

const aggregateExchangeEntriesByOrder = (entryRows: ExchangeEntryRecord[]) => {
  const grouped = new Map<
    string,
    ExchangeEntryRecord & {
      _qtyForPricing: number;
      _notionalForPricing: number;
    }
  >();

  entryRows.forEach((entry, index) => {
    const orderLinkId = toNonEmptyString(entry.orderLinkId);
    const orderId = toNonEmptyString(entry.orderId);
    const groupKey =
      orderLinkId ||
      orderId ||
      `${entry.symbol}:${entry.direction}:${entry.entryTimestamp}:${index}`;
    const existing = grouped.get(groupKey);

    if (!existing) {
      grouped.set(groupKey, {
        ...entry,
        qty: Number.isFinite(entry.qty) ? entry.qty : 0,
        _qtyForPricing:
          Number.isFinite(entry.qty) &&
          Number.isFinite(entry.entryPrice) &&
          entry.entryPrice != null
            ? entry.qty
            : 0,
        _notionalForPricing:
          Number.isFinite(entry.qty) &&
          Number.isFinite(entry.entryPrice) &&
          entry.entryPrice != null
            ? entry.qty * entry.entryPrice
            : 0,
      });
      return;
    }

    existing.qty += Number.isFinite(entry.qty) ? entry.qty : 0;
    existing.entryTimestamp = Math.min(
      existing.entryTimestamp,
      entry.entryTimestamp,
    );

    if (
      Number.isFinite(entry.qty) &&
      Number.isFinite(entry.entryPrice) &&
      entry.entryPrice != null
    ) {
      existing._qtyForPricing += entry.qty;
      existing._notionalForPricing += entry.qty * entry.entryPrice;
    }
  });

  return [...grouped.values()]
    .map(({ _qtyForPricing, _notionalForPricing, ...entry }) => ({
      ...entry,
      qty: roundValue(entry.qty, 8),
      entryPrice:
        _qtyForPricing > 0
          ? roundValue(_notionalForPricing / _qtyForPricing, 8)
          : null,
    }))
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

export const buildExchangeFallbackRuntimeTrades = ({
  entryRows,
  closedPnlRows,
  openPositions,
  strategyNames,
  existingTrades,
  endTime,
}: {
  entryRows: ExchangeEntryRecord[];
  closedPnlRows: ClosedPnlRecordWithOrderLinkId[];
  openPositions: PositionPnlSnapshot[];
  strategyNames: string[];
  existingTrades: RuntimeTradeRecord[];
  endTime: number;
}) => {
  if (!entryRows.length) {
    return [];
  }

  const strategyNameByOrderId = new Map(
    existingTrades
      .filter(
        (trade): trade is RuntimeTradeRecord & { strategy: string } =>
          typeof trade.orderId === 'string' &&
          trade.orderId.trim().length > 0 &&
          typeof trade.strategy === 'string' &&
          trade.strategy.trim().length > 0,
      )
      .map((trade) => [trade.orderId, trade.strategy]),
  );
  const strategyNamesPool = [
    ...new Set([
      ...strategyNames,
      ...existingTrades.map((trade) => trade.strategy).filter(Boolean),
    ]),
  ];
  const openPositionBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const existingOrderIds = new Set(
    existingTrades
      .map((trade) => toNonEmptyString(trade.orderId))
      .filter((value): value is string => value != null),
  );
  const exactByOrderLinkId = new Map(
    closedPnlRows
      .filter(
        (
          row,
        ): row is ClosedPnlRecordWithOrderLinkId & { orderLinkId: string } =>
          typeof row.orderLinkId === 'string' && row.orderLinkId.length > 0,
      )
      .map((row) => [row.orderLinkId, row]),
  );
  const exactByOrderId = new Map(
    closedPnlRows
      .filter(
        (row): row is ClosedPnlRecordWithOrderLinkId & { orderId: string } =>
          typeof row.orderId === 'string' && row.orderId.length > 0,
      )
      .map((row) => [row.orderId, row]),
  );
  const symbolBuckets = new Map<string, ClosedPnlRecordWithOrderLinkId[]>();

  for (const row of closedPnlRows) {
    const bucket = symbolBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    symbolBuckets.set(row.symbol, bucket);
  }

  const fallbackTrades = aggregateExchangeEntriesByOrder(entryRows)
    .map<RuntimeTradeRecord | null>((entry) => {
      const normalizedOrderLinkId = toNonEmptyString(entry.orderLinkId);
      const normalizedOrderId = toNonEmptyString(entry.orderId);
      const runtimeOrderId = normalizedOrderLinkId ?? normalizedOrderId;

      if (!runtimeOrderId || existingOrderIds.has(runtimeOrderId)) {
        return null;
      }

      const strategyName =
        (normalizedOrderLinkId
          ? strategyNameByOrderId.get(normalizedOrderLinkId)
          : null) ??
        (normalizedOrderId
          ? strategyNameByOrderId.get(normalizedOrderId)
          : null) ??
        resolveStrategyNameByOrderLinkId({
          orderLinkId: normalizedOrderLinkId,
          strategyNames: strategyNamesPool,
        });

      if (!strategyName) {
        return null;
      }

      const matchedClosedPnl = takeClosedPnlMatchForExchangeEntry({
        exactByOrderLinkId,
        exactByOrderId,
        symbolBuckets,
        entry,
      });
      const openPosition = openPositionBySymbol.get(entry.symbol);
      const isActive =
        !matchedClosedPnl &&
        openPosition?.direction === entry.direction &&
        Number.isFinite(openPosition.currentPrice) &&
        Number.isFinite(openPosition.unrealizedPnl);
      const entryPrice =
        typeof entry.entryPrice === 'number' &&
        Number.isFinite(entry.entryPrice)
          ? entry.entryPrice
          : typeof matchedClosedPnl?.entryPrice === 'number' &&
              Number.isFinite(matchedClosedPnl.entryPrice)
            ? matchedClosedPnl.entryPrice
            : null;

      if (entryPrice == null) {
        return null;
      }

      return {
        orderId: runtimeOrderId,
        strategy: strategyName,
        symbol: entry.symbol,
        direction: entry.direction,
        qty: entry.qty,
        entryPrice,
        entryTimestamp: entry.entryTimestamp,
        status: isActive ? 'active' : 'closed',
        currentPrice: isActive
          ? openPosition?.currentPrice ?? null
          : matchedClosedPnl?.exitPrice ?? null,
        currentPnl: isActive
          ? openPosition?.unrealizedPnl ?? null
          : matchedClosedPnl?.closedPnl ?? null,
        closedPnl: isActive ? null : matchedClosedPnl?.closedPnl ?? null,
        exitPrice: isActive ? null : matchedClosedPnl?.exitPrice ?? null,
        exitTimestamp: isActive ? null : matchedClosedPnl?.closedAt ?? null,
        lastSyncedAt: endTime,
      };
    })
    .filter((trade): trade is RuntimeTradeRecord => trade != null);

  return fallbackTrades.sort(
    (left, right) => left.entryTimestamp - right.entryTimestamp,
  );
};
