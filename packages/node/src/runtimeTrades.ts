import { resolveStrategyNameByOrderLinkId } from '@tradejs/core/backtest';
import type {
  ExchangeEntryRecord,
  PositionPnlSnapshot,
  RuntimeTradeRecord,
} from '@tradejs/types';
import {
  takeExactClosedPnlMatch,
  type ClosedPnlRecordWithOrderLinkId,
} from './runtimeTradeReconciliation';

export * from './runtimeTradeReconciliation';

const toNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const roundValue = (value: number, digits = 2) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const removeExactMatches = (
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>,
  exactByOrderId: Map<string, ClosedPnlRecordWithOrderLinkId>,
  row: ClosedPnlRecordWithOrderLinkId,
) => {
  if (row.orderLinkId) exactByOrderLinkId.delete(row.orderLinkId);
  if (row.orderId) exactByOrderId.delete(row.orderId);
};

const takeClosedPnlMatchForEntry = ({
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
  if (exactMatch) return exactMatch;

  const rows = symbolBuckets.get(entry.symbol);
  if (!rows?.length) return null;
  const minimumClosedAt = entry.entryTimestamp - 5 * 60_000;
  const matchIndex = rows.reduce((bestIndex, row, index) => {
    if (
      !Number.isFinite(row.closedAt) ||
      row.closedAt < minimumClosedAt ||
      (row.direction && row.direction !== entry.direction)
    ) {
      return bestIndex;
    }
    if (bestIndex < 0) return index;
    return row.closedAt < rows[bestIndex].closedAt ? index : bestIndex;
  }, -1);
  if (matchIndex < 0) return null;
  const [match] = rows.splice(matchIndex, 1);
  if (match) removeExactMatches(exactByOrderLinkId, exactByOrderId, match);
  return match ?? null;
};

const aggregateExchangeEntriesByOrder = (entryRows: ExchangeEntryRecord[]) => {
  const grouped = new Map<
    string,
    ExchangeEntryRecord & { pricingQty: number; pricingNotional: number }
  >();
  entryRows.forEach((entry, index) => {
    const orderLinkId = toNonEmptyString(entry.orderLinkId);
    const orderId = toNonEmptyString(entry.orderId);
    const key =
      orderLinkId ||
      orderId ||
      `${entry.symbol}:${entry.direction}:${entry.entryTimestamp}:${index}`;
    const existing = grouped.get(key);
    const hasPrice =
      Number.isFinite(entry.qty) &&
      typeof entry.entryPrice === 'number' &&
      Number.isFinite(entry.entryPrice);
    if (!existing) {
      grouped.set(key, {
        ...entry,
        qty: Number.isFinite(entry.qty) ? entry.qty : 0,
        pricingQty: hasPrice ? entry.qty : 0,
        pricingNotional: hasPrice ? entry.qty * (entry.entryPrice ?? 0) : 0,
      });
      return;
    }
    existing.qty += Number.isFinite(entry.qty) ? entry.qty : 0;
    existing.entryTimestamp = Math.min(
      existing.entryTimestamp,
      entry.entryTimestamp,
    );
    if (hasPrice) {
      existing.pricingQty += entry.qty;
      existing.pricingNotional += entry.qty * (entry.entryPrice ?? 0);
    }
  });
  return [...grouped.values()]
    .map(({ pricingQty, pricingNotional, ...entry }) => ({
      ...entry,
      qty: roundValue(entry.qty, 8),
      entryPrice:
        pricingQty > 0 ? roundValue(pricingNotional / pricingQty, 8) : null,
    }))
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

const resolveStrategy = ({
  orderLinkId,
  orderId,
  strategyNameByOrderId,
  strategyNames,
}: {
  orderLinkId: string | null;
  orderId: string | null;
  strategyNameByOrderId: Map<string, string>;
  strategyNames: string[];
}) =>
  (orderLinkId ? strategyNameByOrderId.get(orderLinkId) : null) ??
  (orderId ? strategyNameByOrderId.get(orderId) : null) ??
  resolveStrategyNameByOrderLinkId({ orderLinkId, strategyNames });

const buildRiskLevels = (
  position: PositionPnlSnapshot | undefined,
): RuntimeTradeRecord['aiAnalysis'] | null => {
  const takeProfitPrice = position?.takeProfitPrice;
  const stopLossPrice = position?.stopLossPrice;
  if (
    (typeof takeProfitPrice !== 'number' ||
      !Number.isFinite(takeProfitPrice)) &&
    (typeof stopLossPrice !== 'number' || !Number.isFinite(stopLossPrice))
  ) {
    return null;
  }
  return {
    ...(typeof takeProfitPrice === 'number' && Number.isFinite(takeProfitPrice)
      ? { takeProfitPrice }
      : {}),
    ...(typeof stopLossPrice === 'number' && Number.isFinite(stopLossPrice)
      ? { stopLossPrice }
      : {}),
  };
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
  if (!entryRows.length && !closedPnlRows.length) return [];
  const strategyNameByOrderId = new Map(
    existingTrades
      .filter((trade): trade is RuntimeTradeRecord & { strategy: string } =>
        Boolean(trade.orderId?.trim() && trade.strategy?.trim()),
      )
      .map((trade) => [trade.orderId, trade.strategy]),
  );
  const strategyNamesPool = [
    ...new Set([
      ...strategyNames,
      ...existingTrades.map(({ strategy }) => strategy),
    ]),
  ];
  const openPositionBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const existingOrderIds = new Set(
    existingTrades
      .map(({ orderId }) => toNonEmptyString(orderId))
      .filter((value): value is string => value != null),
  );
  const exactByOrderLinkId = new Map(
    closedPnlRows
      .filter((row) => Boolean(row.orderLinkId))
      .map((row) => [row.orderLinkId!, row]),
  );
  const exactByOrderId = new Map(
    closedPnlRows
      .filter((row) => Boolean(row.orderId))
      .map((row) => [row.orderId!, row]),
  );
  const symbolBuckets = new Map<string, ClosedPnlRecordWithOrderLinkId[]>();
  for (const row of closedPnlRows) {
    const bucket = symbolBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    symbolBuckets.set(row.symbol, bucket);
  }

  const fallbackTrades = aggregateExchangeEntriesByOrder(entryRows)
    .map<RuntimeTradeRecord | null>((entry) => {
      const orderLinkId = toNonEmptyString(entry.orderLinkId);
      const orderId = toNonEmptyString(entry.orderId);
      const runtimeOrderId = orderLinkId ?? orderId;
      if (!runtimeOrderId || existingOrderIds.has(runtimeOrderId)) return null;
      const strategy = resolveStrategy({
        orderLinkId,
        orderId,
        strategyNameByOrderId,
        strategyNames: strategyNamesPool,
      });
      if (!strategy) return null;
      const closed = takeClosedPnlMatchForEntry({
        exactByOrderLinkId,
        exactByOrderId,
        symbolBuckets,
        entry,
      });
      const position = openPositionBySymbol.get(entry.symbol);
      const isActive =
        !closed &&
        position?.direction === entry.direction &&
        Number.isFinite(position.currentPrice) &&
        Number.isFinite(position.unrealizedPnl);
      const entryPrice =
        typeof entry.entryPrice === 'number' &&
        Number.isFinite(entry.entryPrice)
          ? entry.entryPrice
          : typeof closed?.entryPrice === 'number' &&
              Number.isFinite(closed.entryPrice)
            ? closed.entryPrice
            : null;
      if (entryPrice == null) return null;
      return {
        orderId: runtimeOrderId,
        strategy,
        symbol: entry.symbol,
        direction: entry.direction,
        qty: entry.qty,
        entryPrice,
        actualEntryPrice: closed?.entryPrice ?? entry.entryPrice ?? null,
        entryTimestamp: entry.entryTimestamp,
        status: isActive ? 'active' : 'closed',
        currentPrice: isActive
          ? position?.currentPrice ?? null
          : closed?.exitPrice ?? null,
        currentPnl: isActive
          ? position?.unrealizedPnl ?? null
          : closed?.closedPnl ?? null,
        closedPnl: isActive ? null : closed?.closedPnl ?? null,
        exitPrice: isActive ? null : closed?.exitPrice ?? null,
        actualExitPrice: isActive ? null : closed?.exitPrice ?? null,
        exitTimestamp: isActive ? null : closed?.closedAt ?? null,
        aiAnalysis: isActive ? buildRiskLevels(position) : null,
        openFee: closed?.openFee ?? entry.openFee ?? null,
        closeFee: closed?.closeFee ?? entry.closeFee ?? null,
        fundingFee: closed?.fundingFee ?? entry.fundingFee ?? null,
        totalFee: closed?.totalFee ?? entry.totalFee ?? null,
        lastSyncedAt: endTime,
      };
    })
    .filter((trade): trade is RuntimeTradeRecord => trade != null);

  const usedOrderIds = new Set([
    ...existingOrderIds,
    ...fallbackTrades.map(({ orderId }) => orderId),
  ]);
  const remainingClosedTrades = [...symbolBuckets.values()]
    .flat()
    .map<RuntimeTradeRecord | null>((row) => {
      const orderLinkId = toNonEmptyString(row.orderLinkId);
      const orderId = toNonEmptyString(row.orderId);
      const runtimeOrderId = orderLinkId ?? orderId;
      if (!runtimeOrderId || usedOrderIds.has(runtimeOrderId)) return null;
      const strategy = resolveStrategy({
        orderLinkId,
        orderId,
        strategyNameByOrderId,
        strategyNames: strategyNamesPool,
      });
      if (
        !strategy ||
        row.entryPrice == null ||
        !Number.isFinite(row.entryPrice) ||
        !row.direction
      ) {
        return null;
      }
      return {
        orderId: runtimeOrderId,
        strategy,
        symbol: row.symbol,
        direction: row.direction,
        qty: row.qty,
        entryPrice: row.entryPrice,
        actualEntryPrice: row.entryPrice,
        entryTimestamp:
          typeof row.entryTimestamp === 'number' &&
          Number.isFinite(row.entryTimestamp)
            ? row.entryTimestamp
            : row.closedAt,
        status: 'closed',
        currentPrice: row.exitPrice,
        currentPnl: row.closedPnl,
        closedPnl: row.closedPnl,
        exitPrice: row.exitPrice,
        actualExitPrice: row.exitPrice,
        exitTimestamp: row.closedAt,
        openFee: row.openFee ?? null,
        closeFee: row.closeFee ?? null,
        fundingFee: row.fundingFee ?? null,
        totalFee: row.totalFee ?? null,
        lastSyncedAt: endTime,
      };
    })
    .filter((trade): trade is RuntimeTradeRecord => trade != null);

  return [...fallbackTrades, ...remainingClosedTrades].sort(
    (left, right) => left.entryTimestamp - right.entryTimestamp,
  );
};
