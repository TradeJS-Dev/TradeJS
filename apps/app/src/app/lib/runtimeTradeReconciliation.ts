import type { ClosedPnlRecord, RuntimeTradeRecord } from '@tradejs/types';

export type ClosedPnlRecordWithOrderLinkId = ClosedPnlRecord & {
  direction?: RuntimeTradeRecord['direction'];
  entryTimestamp?: number;
  orderLinkId?: string;
};

const toNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const removeFromExactMaps = ({
  exactByOrderLinkId,
  exactByOrderId,
  row,
}: {
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  exactByOrderId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  row: ClosedPnlRecordWithOrderLinkId;
}) => {
  for (const [key, value] of exactByOrderLinkId) {
    if (value === row) exactByOrderLinkId.delete(key);
  }
  for (const [key, value] of exactByOrderId) {
    if (value === row) exactByOrderId.delete(key);
  }
};

const removeFromSymbolBuckets = (
  buckets: Map<string, ClosedPnlRecordWithOrderLinkId[]>,
  row: ClosedPnlRecordWithOrderLinkId,
) => {
  const rows = buckets.get(row.symbol);
  const index = rows?.findIndex((candidate) => candidate === row) ?? -1;
  if (index >= 0) rows?.splice(index, 1);
};

export const takeExactClosedPnlMatch = ({
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
    if (!normalizedKey) continue;
    const exactMatch = bucket.get(normalizedKey);
    if (!exactMatch) continue;
    removeFromExactMaps({
      exactByOrderLinkId,
      exactByOrderId,
      row: exactMatch,
    });
    removeFromSymbolBuckets(symbolBuckets, exactMatch);
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
    orderId: trade.orderId,
  });
  if (exactMatch) return exactMatch;

  const rows = symbolBuckets.get(trade.symbol);
  if (!rows?.length) return null;
  const minimumClosedAt = trade.entryTimestamp - 5 * 60_000;
  const matchIndex = rows.reduce((bestIndex, row, index) => {
    if (
      !Number.isFinite(row.closedAt) ||
      row.closedAt < minimumClosedAt ||
      (row.direction && row.direction !== trade.direction)
    ) {
      return bestIndex;
    }
    if (bestIndex < 0) return index;
    return row.closedAt < rows[bestIndex].closedAt ? index : bestIndex;
  }, -1);
  if (matchIndex < 0) return null;
  const [row] = rows.splice(matchIndex, 1);
  if (row) {
    removeFromExactMaps({ exactByOrderLinkId, exactByOrderId, row });
  }
  return row ?? null;
};
