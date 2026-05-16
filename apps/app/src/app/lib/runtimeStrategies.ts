import type { ClosedPnlRecord, RuntimeTradeRecord } from '@tradejs/types';

type ClosedPnlRecordWithOrderLinkId = ClosedPnlRecord & {
  orderLinkId?: string;
};

export interface RuntimeStrategyStats {
  trades: number;
  activeTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  closedPnl: number;
  activePnl: number;
  avgClosedPnl: number;
}

export interface RuntimeStrategyChartMarker {
  orderId: string;
  symbol: string;
  timestamp: number;
  price: number;
  kind: 'entry' | 'exit';
  direction: RuntimeTradeRecord['direction'];
  status: RuntimeTradeRecord['status'];
  pnl: number | null;
}

export interface RuntimeStrategyPricePoint {
  timestamp: number;
  close: number;
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
  focusSymbol: string | null;
  stats: RuntimeStrategyStats;
  chart: RuntimeStrategyPricePoint[];
  markers: RuntimeStrategyChartMarker[];
  recentTrades: RuntimeStrategyTradeView[];
}

export interface RuntimeStrategiesResponse {
  provider: string;
  hours: number;
  generatedAt: number;
  strategies: RuntimeStrategyView[];
}

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
) =>
  trades.filter((trade) => {
    if (trade.status === 'active') {
      return true;
    }

    const exitTimestamp =
      typeof trade.exitTimestamp === 'number' ? trade.exitTimestamp : 0;

    return trade.entryTimestamp >= startTime || exitTimestamp >= startTime;
  });

const roundPnl = (value: number) =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : 0;

const getTradePnl = (trade: RuntimeTradeRecord) =>
  trade.status === 'closed'
    ? trade.closedPnl ?? trade.currentPnl ?? null
    : trade.currentPnl ?? null;

export const buildRuntimeStrategyStats = (
  trades: RuntimeTradeRecord[],
): RuntimeStrategyStats => {
  let activeTrades = 0;
  let closedTrades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnl = 0;
  let closedPnl = 0;
  let activePnl = 0;
  let closedKnownCount = 0;

  for (const trade of trades) {
    const pnl = getTradePnl(trade);

    if (trade.status === 'active') {
      activeTrades += 1;
      if (typeof pnl === 'number' && Number.isFinite(pnl)) {
        activePnl += pnl;
        totalPnl += pnl;
      }
      continue;
    }

    closedTrades += 1;

    if (typeof pnl !== 'number' || !Number.isFinite(pnl)) {
      continue;
    }

    closedKnownCount += 1;
    closedPnl += pnl;
    totalPnl += pnl;

    if (pnl > 0) {
      wins += 1;
    } else if (pnl < 0) {
      losses += 1;
    }
  }

  return {
    trades: trades.length,
    activeTrades,
    closedTrades,
    wins,
    losses,
    winRate:
      closedKnownCount > 0 ? roundPnl((wins / closedKnownCount) * 100) : 0,
    totalPnl: roundPnl(totalPnl),
    closedPnl: roundPnl(closedPnl),
    activePnl: roundPnl(activePnl),
    avgClosedPnl:
      closedKnownCount > 0 ? roundPnl(closedPnl / closedKnownCount) : 0,
  };
};

export const selectFocusSymbol = (
  trades: RuntimeTradeRecord[],
): string | null => {
  const activeTrade = [...trades]
    .reverse()
    .find((trade) => trade.status === 'active' && trade.symbol);

  if (activeTrade?.symbol) {
    return activeTrade.symbol;
  }

  const latestTrade = [...trades]
    .sort((left, right) => right.entryTimestamp - left.entryTimestamp)
    .find((trade) => trade.symbol);

  return latestTrade?.symbol ?? null;
};

export const buildStrategyTradeMarkers = (
  trades: RuntimeTradeRecord[],
  symbol: string,
): RuntimeStrategyChartMarker[] => {
  const markers: RuntimeStrategyChartMarker[] = [];

  for (const trade of trades) {
    if (trade.symbol !== symbol) {
      continue;
    }

    markers.push({
      orderId: trade.orderId,
      symbol: trade.symbol,
      timestamp: trade.entryTimestamp,
      price: trade.entryPrice,
      kind: 'entry',
      direction: trade.direction,
      status: trade.status,
      pnl: getTradePnl(trade),
    });

    if (
      trade.status === 'closed' &&
      typeof trade.exitTimestamp === 'number' &&
      Number.isFinite(trade.exitTimestamp) &&
      typeof trade.exitPrice === 'number' &&
      Number.isFinite(trade.exitPrice)
    ) {
      markers.push({
        orderId: trade.orderId,
        symbol: trade.symbol,
        timestamp: trade.exitTimestamp,
        price: trade.exitPrice,
        kind: 'exit',
        direction: trade.direction,
        status: trade.status,
        pnl: getTradePnl(trade),
      });
    }
  }

  return markers.sort((left, right) => left.timestamp - right.timestamp);
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

export const takeClosedPnlMatch = ({
  exactByOrderLinkId,
  symbolBuckets,
  trade,
}: {
  exactByOrderLinkId: Map<string, ClosedPnlRecordWithOrderLinkId>;
  symbolBuckets: Map<string, ClosedPnlRecordWithOrderLinkId[]>;
  trade: RuntimeTradeRecord;
}) => {
  const orderLinkId = trade.orderId?.trim();

  if (orderLinkId) {
    const exactMatch = exactByOrderLinkId.get(orderLinkId);
    if (exactMatch) {
      exactByOrderLinkId.delete(orderLinkId);
      removeClosedPnlFromSymbolBuckets(symbolBuckets, exactMatch);
      return exactMatch;
    }
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
  if (row?.orderLinkId) {
    exactByOrderLinkId.delete(row.orderLinkId);
  }

  return row ?? null;
};
