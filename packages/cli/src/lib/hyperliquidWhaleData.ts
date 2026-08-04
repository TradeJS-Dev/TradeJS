import type {
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
};

type SnapshotIdentity = {
  universeFingerprint: string;
  whaleRegistryFingerprint: string;
};

const finiteNumber = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

  type MutableWhaleFlowRow = Omit<HyperliquidWhaleFlowRow, 'whaleAddresses'> & {
    whaleAddresses: Set<string>;
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
    row.uniqueWhales = row.whaleAddresses.size;
    row.netNotionalUsd = row.buyNotionalUsd - row.sellNotionalUsd;
    const total = row.buyNotionalUsd + row.sellNotionalUsd;
    row.buySharePct = total > 0 ? row.buyNotionalUsd / total : null;
    buckets.set(key, row);
  }

  return [...buckets.values()]
    .map(({ whaleAddresses, ...row }) => ({
      ...row,
      whaleAddresses: [...whaleAddresses].sort(),
    }))
    .sort(
      (left, right) =>
        left.ts.getTime() - right.ts.getTime() ||
        left.symbol.localeCompare(right.symbol),
    );
};
