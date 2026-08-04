import type {
  HyperliquidPositionAction,
  HyperliquidWhaleFlowRow,
  HyperliquidWhaleTradeEventRow,
} from '@tradejs/types';

export const HYPERLIQUID_WHALE_BUCKET_MS = 60_000;

export type HyperliquidWsTrade = {
  coin?: unknown;
  side?: unknown;
  px?: unknown;
  sz?: unknown;
  time?: unknown;
  tid?: unknown;
  users?: unknown;
};

export type HyperliquidUserFill = {
  coin?: unknown;
  side?: unknown;
  px?: unknown;
  sz?: unknown;
  time?: unknown;
  tid?: unknown;
  startPosition?: unknown;
  dir?: unknown;
  closedPnl?: unknown;
  liquidation?: unknown;
};

type SnapshotIdentity = {
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
};

const finiteNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const POSITION_EPSILON = 1e-12;

const normalizePosition = (value: number) =>
  Math.abs(value) <= POSITION_EPSILON ? 0 : value;

export type HyperliquidPositionChange = {
  startPosition: number;
  endPosition: number;
  action: HyperliquidPositionAction;
  longEntrySize: number;
  shortEntrySize: number;
  longExitSize: number;
  shortExitSize: number;
};

export const classifyHyperliquidPositionChange = (params: {
  startPosition: unknown;
  side: unknown;
  size: unknown;
}): HyperliquidPositionChange | null => {
  const startValue = finiteNumber(params.startPosition);
  const size = finiteNumber(params.size);
  const side = String(params.side ?? '').toUpperCase();
  if (startValue == null || size == null || size <= 0) return null;
  if (side !== 'B' && side !== 'A') return null;

  const startPosition = normalizePosition(startValue);
  const endPosition = normalizePosition(
    startPosition + (side === 'B' ? size : -size),
  );
  const startLong = Math.max(startPosition, 0);
  const endLong = Math.max(endPosition, 0);
  const startShort = Math.max(-startPosition, 0);
  const endShort = Math.max(-endPosition, 0);
  const longEntrySize = Math.max(0, endLong - startLong);
  const shortEntrySize = Math.max(0, endShort - startShort);
  const longExitSize = Math.max(0, startLong - endLong);
  const shortExitSize = Math.max(0, startShort - endShort);
  const flipped = startPosition * endPosition < 0;
  const opened = startPosition === 0;
  const closed = endPosition === 0;
  const increased =
    Math.sign(startPosition) === Math.sign(endPosition) &&
    Math.abs(endPosition) > Math.abs(startPosition);

  return {
    startPosition,
    endPosition,
    action: flipped
      ? 'flip'
      : opened
        ? 'open'
        : closed
          ? 'close'
          : increased
            ? 'increase'
            : 'reduce',
    longEntrySize,
    shortEntrySize,
    longExitSize,
    shortExitSize,
  };
};

const normalizeAddress = (value: unknown) =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? value.toLowerCase()
    : null;

const normalizeTradeFields = (
  value: HyperliquidWsTrade | HyperliquidUserFill,
) => {
  const symbol = typeof value.coin === 'string' ? value.coin.trim() : '';
  const price = finiteNumber(value.px);
  const size = finiteNumber(value.sz);
  const timestamp = finiteNumber(value.time);
  const tid =
    typeof value.tid === 'string' || typeof value.tid === 'number'
      ? String(value.tid)
      : '';
  if (
    !symbol ||
    price == null ||
    size == null ||
    timestamp == null ||
    !tid ||
    price <= 0 ||
    size <= 0
  ) {
    return null;
  }
  return {
    symbol,
    price,
    size,
    timestamp,
    tid,
    notionalUsd: price * size,
  };
};

export const normalizeHyperliquidWsTrade = (params: {
  trade: HyperliquidWsTrade;
  trackedSymbols: ReadonlySet<string>;
  trackedWhales: ReadonlySet<string>;
  identity: SnapshotIdentity;
}): HyperliquidWhaleTradeEventRow | null => {
  const normalized = normalizeTradeFields(params.trade);
  if (!normalized || !params.trackedSymbols.has(normalized.symbol)) return null;
  const users = Array.isArray(params.trade.users) ? params.trade.users : [];
  const buyerAddress = normalizeAddress(users[0]);
  const sellerAddress = normalizeAddress(users[1]);
  const buyerTracked =
    buyerAddress != null && params.trackedWhales.has(buyerAddress);
  const sellerTracked =
    sellerAddress != null && params.trackedWhales.has(sellerAddress);
  if (!buyerTracked && !sellerTracked) return null;
  return {
    symbol: normalized.symbol,
    ts: new Date(normalized.timestamp),
    tid: normalized.tid,
    price: normalized.price,
    size: normalized.size,
    notionalUsd: normalized.notionalUsd,
    buyerAddress,
    sellerAddress,
    buyerTracked,
    sellerTracked,
    ...params.identity,
    source: 'hyperliquid_trades',
  };
};

export const normalizeHyperliquidUserFill = (params: {
  fill: HyperliquidUserFill;
  address: string;
  trackedSymbols: ReadonlySet<string>;
  identity: SnapshotIdentity;
}): HyperliquidWhaleTradeEventRow | null => {
  const normalized = normalizeTradeFields(params.fill);
  if (!normalized || !params.trackedSymbols.has(normalized.symbol)) return null;
  const address = normalizeAddress(params.address);
  if (!address) return null;
  const side = String(params.fill.side ?? '').toUpperCase();
  if (side !== 'B' && side !== 'A') return null;
  const positionChange = classifyHyperliquidPositionChange({
    startPosition: params.fill.startPosition,
    side,
    size: normalized.size,
  });
  const closedPnl = finiteNumber(params.fill.closedPnl);
  const liquidation =
    params.fill.liquidation != null &&
    typeof params.fill.liquidation === 'object';
  const positionFields: Partial<HyperliquidWhaleTradeEventRow> = positionChange
    ? side === 'B'
      ? {
          buyerStartPosition: positionChange.startPosition,
          buyerEndPosition: positionChange.endPosition,
          buyerPositionAction: positionChange.action,
          buyerClosedPnl: closedPnl,
          buyerLiquidation: liquidation,
        }
      : {
          sellerStartPosition: positionChange.startPosition,
          sellerEndPosition: positionChange.endPosition,
          sellerPositionAction: positionChange.action,
          sellerClosedPnl: closedPnl,
          sellerLiquidation: liquidation,
        }
    : {};
  return {
    symbol: normalized.symbol,
    ts: new Date(normalized.timestamp),
    tid: normalized.tid,
    price: normalized.price,
    size: normalized.size,
    notionalUsd: normalized.notionalUsd,
    buyerAddress: side === 'B' ? address : null,
    sellerAddress: side === 'A' ? address : null,
    buyerTracked: side === 'B',
    sellerTracked: side === 'A',
    ...positionFields,
    ...params.identity,
    source: 'hyperliquid_user_fills',
  };
};

const eventKey = (event: HyperliquidWhaleTradeEventRow) =>
  `${event.universeFingerprint}:${event.whaleRegistryFingerprint}:${event.symbol}:${event.ts.getTime()}:${event.tid}`;

const mergeEvent = (
  left: HyperliquidWhaleTradeEventRow,
  right: HyperliquidWhaleTradeEventRow,
): HyperliquidWhaleTradeEventRow => ({
  ...left,
  buyerAddress: left.buyerAddress ?? right.buyerAddress,
  sellerAddress: left.sellerAddress ?? right.sellerAddress,
  buyerTracked: left.buyerTracked || right.buyerTracked,
  sellerTracked: left.sellerTracked || right.sellerTracked,
  buyerStartPosition: left.buyerStartPosition ?? right.buyerStartPosition,
  buyerEndPosition: left.buyerEndPosition ?? right.buyerEndPosition,
  buyerPositionAction: left.buyerPositionAction ?? right.buyerPositionAction,
  buyerClosedPnl: left.buyerClosedPnl ?? right.buyerClosedPnl,
  buyerLiquidation: left.buyerLiquidation ?? right.buyerLiquidation,
  sellerStartPosition: left.sellerStartPosition ?? right.sellerStartPosition,
  sellerEndPosition: left.sellerEndPosition ?? right.sellerEndPosition,
  sellerPositionAction: left.sellerPositionAction ?? right.sellerPositionAction,
  sellerClosedPnl: left.sellerClosedPnl ?? right.sellerClosedPnl,
  sellerLiquidation: left.sellerLiquidation ?? right.sellerLiquidation,
});

export const aggregateHyperliquidWhaleEvents = (
  events: HyperliquidWhaleTradeEventRow[],
): HyperliquidWhaleFlowRow[] => {
  const deduplicated = new Map<string, HyperliquidWhaleTradeEventRow>();
  for (const event of events) {
    const key = eventKey(event);
    const previous = deduplicated.get(key);
    deduplicated.set(key, previous ? mergeEvent(previous, event) : event);
  }

  type MutableWhaleFlowRow = Omit<
    HyperliquidWhaleFlowRow,
    | 'whaleAddresses'
    | 'longEntryWhaleAddresses'
    | 'shortEntryWhaleAddresses'
    | 'longExitWhaleAddresses'
    | 'shortExitWhaleAddresses'
  > & {
    whaleAddresses: Set<string>;
    longEntryWhaleAddresses: Set<string>;
    shortEntryWhaleAddresses: Set<string>;
    longExitWhaleAddresses: Set<string>;
    shortExitWhaleAddresses: Set<string>;
  };
  const buckets = new Map<string, MutableWhaleFlowRow>();
  for (const event of deduplicated.values()) {
    const bucketTs =
      Math.floor(event.ts.getTime() / HYPERLIQUID_WHALE_BUCKET_MS) *
      HYPERLIQUID_WHALE_BUCKET_MS;
    const key = `${event.universeFingerprint}:${event.whaleRegistryFingerprint}:${event.symbol}:${bucketTs}`;
    const row =
      buckets.get(key) ??
      ({
        symbol: event.symbol,
        interval: '1m',
        ts: new Date(bucketTs),
        trades: 0,
        whaleSides: 0,
        uniqueWhales: 0,
        buyNotionalUsd: 0,
        sellNotionalUsd: 0,
        netNotionalUsd: 0,
        buySharePct: null,
        positionAwareWhaleSides: 0,
        longEntryWhaleAddresses: new Set<string>(),
        shortEntryWhaleAddresses: new Set<string>(),
        longExitWhaleAddresses: new Set<string>(),
        shortExitWhaleAddresses: new Set<string>(),
        longEntryNotionalUsd: 0,
        shortEntryNotionalUsd: 0,
        longExitNotionalUsd: 0,
        shortExitNotionalUsd: 0,
        entryNetNotionalUsd: 0,
        entryLongSharePct: null,
        universeFingerprint: event.universeFingerprint,
        whaleRegistryFingerprint: event.whaleRegistryFingerprint,
        source: 'hyperliquid_trades',
        whaleAddresses: new Set<string>(),
      } satisfies MutableWhaleFlowRow);

    row.trades += 1;
    if (event.buyerTracked) {
      row.whaleSides += 1;
      row.buyNotionalUsd += event.notionalUsd;
      if (event.buyerAddress) row.whaleAddresses.add(event.buyerAddress);
    }
    if (event.sellerTracked) {
      row.whaleSides += 1;
      row.sellNotionalUsd += event.notionalUsd;
      if (event.sellerAddress) row.whaleAddresses.add(event.sellerAddress);
    }

    const applyPositionLeg = (params: {
      address: string | null | undefined;
      startPosition: number | null | undefined;
      endPosition: number | null | undefined;
    }) => {
      if (
        !params.address ||
        !Number.isFinite(params.startPosition) ||
        !Number.isFinite(params.endPosition)
      ) {
        return;
      }
      const startPosition = Number(params.startPosition);
      const endPosition = Number(params.endPosition);
      const longEntrySize = Math.max(
        0,
        Math.max(endPosition, 0) - Math.max(startPosition, 0),
      );
      const shortEntrySize = Math.max(
        0,
        Math.max(-endPosition, 0) - Math.max(-startPosition, 0),
      );
      const longExitSize = Math.max(
        0,
        Math.max(startPosition, 0) - Math.max(endPosition, 0),
      );
      const shortExitSize = Math.max(
        0,
        Math.max(-startPosition, 0) - Math.max(-endPosition, 0),
      );
      row.positionAwareWhaleSides += 1;
      row.longEntryNotionalUsd += longEntrySize * event.price;
      row.shortEntryNotionalUsd += shortEntrySize * event.price;
      row.longExitNotionalUsd += longExitSize * event.price;
      row.shortExitNotionalUsd += shortExitSize * event.price;
      if (longEntrySize > 0) row.longEntryWhaleAddresses.add(params.address);
      if (shortEntrySize > 0) row.shortEntryWhaleAddresses.add(params.address);
      if (longExitSize > 0) row.longExitWhaleAddresses.add(params.address);
      if (shortExitSize > 0) row.shortExitWhaleAddresses.add(params.address);
    };
    if (event.buyerTracked) {
      applyPositionLeg({
        address: event.buyerAddress,
        startPosition: event.buyerStartPosition,
        endPosition: event.buyerEndPosition,
      });
    }
    if (event.sellerTracked) {
      applyPositionLeg({
        address: event.sellerAddress,
        startPosition: event.sellerStartPosition,
        endPosition: event.sellerEndPosition,
      });
    }
    row.uniqueWhales = row.whaleAddresses.size;
    row.netNotionalUsd = row.buyNotionalUsd - row.sellNotionalUsd;
    const total = row.buyNotionalUsd + row.sellNotionalUsd;
    row.buySharePct = total > 0 ? row.buyNotionalUsd / total : null;
    row.entryNetNotionalUsd =
      row.longEntryNotionalUsd - row.shortEntryNotionalUsd;
    const entryTotal = row.longEntryNotionalUsd + row.shortEntryNotionalUsd;
    row.entryLongSharePct =
      entryTotal > 0 ? row.longEntryNotionalUsd / entryTotal : null;
    if (row.positionAwareWhaleSides > 0) {
      row.source = 'hyperliquid_user_fills';
    }
    buckets.set(key, row);
  }

  return [...buckets.values()]
    .map(
      ({
        whaleAddresses,
        longEntryWhaleAddresses,
        shortEntryWhaleAddresses,
        longExitWhaleAddresses,
        shortExitWhaleAddresses,
        ...row
      }) => ({
        ...row,
        whaleAddresses: [...whaleAddresses].sort(),
        longEntryWhaleAddresses: [...longEntryWhaleAddresses].sort(),
        shortEntryWhaleAddresses: [...shortEntryWhaleAddresses].sort(),
        longExitWhaleAddresses: [...longExitWhaleAddresses].sort(),
        shortExitWhaleAddresses: [...shortExitWhaleAddresses].sort(),
      }),
    )
    .sort(
      (left, right) =>
        left.ts.getTime() - right.ts.getTime() ||
        left.symbol.localeCompare(right.symbol),
    );
};
