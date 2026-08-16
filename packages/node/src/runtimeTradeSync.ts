import { TTL_1M } from '@tradejs/core/constants';
import { getRuntimeStorageDayKey } from '@tradejs/core/time';
import {
  delKey,
  getData,
  redisKeys,
  setData,
  setHashJsonField,
} from '@tradejs/infra/redis';
import type {
  ClosedPnlRecord,
  Connector,
  PositionPnlSnapshot,
  RuntimeTradeRecord,
} from '@tradejs/types';
import { takeClosedPnlMatch } from './runtimeTrades';

export interface RuntimeTradeStore {
  getActiveOrderId(input: {
    userName: string;
    symbol: string;
    scopeId?: string;
  }): Promise<string | null>;
  saveTrade(input: {
    userName: string;
    trade: RuntimeTradeRecord;
    expire: number;
  }): Promise<void>;
  saveClosedTrade(input: {
    userName: string;
    trade: RuntimeTradeRecord;
    expire: number;
  }): Promise<void>;
  deleteActiveTrade(input: {
    userName: string;
    symbol: string;
    scopeId?: string;
  }): Promise<void>;
}

export const redisRuntimeTradeStore: RuntimeTradeStore = {
  async getActiveOrderId({ userName, symbol, scopeId }) {
    const value = (await getData(
      redisKeys.runtimeActiveTrade(userName, symbol, scopeId),
      null,
    )) as { orderId?: string } | null;
    return typeof value?.orderId === 'string' ? value.orderId : null;
  },
  async saveTrade({ userName, trade, expire }) {
    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, trade.orderId), trade, {
        expire,
      }),
      setHashJsonField(
        redisKeys.runtimeTradeBucket(
          userName,
          getRuntimeStorageDayKey(trade.entryTimestamp),
        ),
        trade.orderId,
        trade,
        { expire },
      ),
    ]);
  },
  async saveClosedTrade({ userName, trade, expire }) {
    await setHashJsonField(
      redisKeys.runtimeClosedTradeBucket(
        userName,
        getRuntimeStorageDayKey(trade.exitTimestamp!),
      ),
      trade.orderId,
      trade,
      { expire },
    );
  },
  async deleteActiveTrade({ userName, symbol, scopeId }) {
    await delKey(redisKeys.runtimeActiveTrade(userName, symbol, scopeId));
  },
};

const getRuntimeTradeScopeId = (trade: RuntimeTradeRecord) =>
  trade.deploymentId ?? trade.accountId;

export const isRuntimeTradeInConnectorScope = (
  trade: RuntimeTradeRecord,
  connector: Connector,
) => {
  if (trade.deploymentId && trade.deploymentId !== connector.deploymentId) {
    return false;
  }
  if (trade.deploymentId && !connector.deploymentId) {
    return false;
  }
  if (trade.accountId && trade.accountId !== connector.accountId) {
    return false;
  }
  if (trade.accountId && !connector.accountId) {
    return false;
  }

  return (trade.universe ?? 'crypto') === connector.universe;
};

const buildRiskLevelsAnalysis = (position: PositionPnlSnapshot) => {
  const takeProfitPrice =
    typeof position.takeProfitPrice === 'number' &&
    Number.isFinite(position.takeProfitPrice)
      ? position.takeProfitPrice
      : null;
  const stopLossPrice =
    typeof position.stopLossPrice === 'number' &&
    Number.isFinite(position.stopLossPrice)
      ? position.stopLossPrice
      : null;

  if (takeProfitPrice == null && stopLossPrice == null) {
    return null;
  }

  return {
    ...(takeProfitPrice != null ? { takeProfitPrice } : {}),
    ...(stopLossPrice != null ? { stopLossPrice } : {}),
  };
};

const hasExchangeCloseDetails = (trade: RuntimeTradeRecord) =>
  trade.status === 'closed' &&
  typeof trade.exitPrice === 'number' &&
  Number.isFinite(trade.exitPrice) &&
  typeof trade.actualExitPrice === 'number' &&
  Number.isFinite(trade.actualExitPrice) &&
  typeof trade.closedPnl === 'number' &&
  Number.isFinite(trade.closedPnl) &&
  typeof trade.openFee === 'number' &&
  Number.isFinite(trade.openFee) &&
  typeof trade.closeFee === 'number' &&
  Number.isFinite(trade.closeFee);

export const syncRuntimeTrades = async ({
  userName,
  connector,
  trades,
  endTime,
  openPositions,
  openPositionsReliable,
  closedPnlRows,
  store = redisRuntimeTradeStore,
}: {
  userName: string;
  connector: Connector;
  trades: RuntimeTradeRecord[];
  endTime: number;
  openPositions: PositionPnlSnapshot[];
  openPositionsReliable: boolean;
  closedPnlRows: ClosedPnlRecord[];
  store?: RuntimeTradeStore;
}) => {
  const openPositionsBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const activeOrderIdByScope = new Map<string, string | null>();
  const activeTradeScopes = [
    ...new Map(
      trades
        .filter((trade) => isRuntimeTradeInConnectorScope(trade, connector))
        .map((trade) => {
          const scope = {
            symbol: trade.symbol,
            scopeId: getRuntimeTradeScopeId(trade),
          };
          return [`${scope.scopeId ?? ''}:${scope.symbol}`, scope] as const;
        }),
    ).values(),
  ];

  await Promise.all(
    activeTradeScopes.map(async ({ symbol, scopeId }) => {
      activeOrderIdByScope.set(
        `${scopeId ?? ''}:${symbol}`,
        await store.getActiveOrderId({ userName, symbol, scopeId }),
      );
    }),
  );

  const exactByOrderLinkId = new Map(
    closedPnlRows
      .filter(
        (row): row is ClosedPnlRecord & { orderLinkId: string } =>
          typeof row.orderLinkId === 'string' && row.orderLinkId.length > 0,
      )
      .map((row) => [row.orderLinkId, row]),
  );
  const exactByOrderId = new Map(
    closedPnlRows
      .filter(
        (row): row is ClosedPnlRecord & { orderId: string } =>
          typeof row.orderId === 'string' && row.orderId.length > 0,
      )
      .map((row) => [row.orderId, row]),
  );
  const symbolBuckets = new Map<string, ClosedPnlRecord[]>();

  for (const row of closedPnlRows) {
    const bucket = symbolBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    symbolBuckets.set(row.symbol, bucket);
  }

  const syncedTrades: RuntimeTradeRecord[] = [];

  for (const trade of trades) {
    if (!isRuntimeTradeInConnectorScope(trade, connector)) {
      syncedTrades.push(trade);
      continue;
    }

    const scopeId = getRuntimeTradeScopeId(trade);
    const isCurrentActiveTrade =
      activeOrderIdByScope.get(`${scopeId ?? ''}:${trade.symbol}`) ===
      trade.orderId;

    if (hasExchangeCloseDetails(trade)) {
      if (isCurrentActiveTrade) {
        await store.deleteActiveTrade({
          userName,
          symbol: trade.symbol,
          scopeId,
        });
      }
      syncedTrades.push(trade);
      continue;
    }

    const openPosition = openPositionsBySymbol.get(trade.symbol);

    if (trade.status === 'active' && !openPositionsReliable) {
      syncedTrades.push(trade);
      continue;
    }

    if (
      trade.status === 'active' &&
      isCurrentActiveTrade &&
      openPosition &&
      openPosition.direction === trade.direction
    ) {
      const riskLevelsAnalysis = buildRiskLevelsAnalysis(openPosition);
      const nextTrade: RuntimeTradeRecord = {
        ...trade,
        status: 'active',
        currentPrice: openPosition.currentPrice,
        currentPnl: openPosition.unrealizedPnl,
        aiAnalysis: riskLevelsAnalysis
          ? { ...(trade.aiAnalysis ?? {}), ...riskLevelsAnalysis }
          : trade.aiAnalysis,
        lastSyncedAt: endTime,
      };

      await store.saveTrade({ userName, trade: nextTrade, expire: 0 });
      syncedTrades.push(nextTrade);
      continue;
    }

    const matchedClosedPnl = takeClosedPnlMatch({
      exactByOrderLinkId,
      exactByOrderId,
      symbolBuckets,
      trade,
    });

    if (!matchedClosedPnl) {
      syncedTrades.push(trade);
      continue;
    }

    const nextTrade: RuntimeTradeRecord = {
      ...trade,
      status: 'closed',
      currentPrice: matchedClosedPnl.exitPrice ?? trade.currentPrice ?? null,
      currentPnl: matchedClosedPnl.closedPnl,
      closedPnl: matchedClosedPnl.closedPnl,
      actualEntryPrice:
        matchedClosedPnl.entryPrice ?? trade.actualEntryPrice ?? null,
      exitPrice: matchedClosedPnl.exitPrice ?? trade.exitPrice ?? null,
      actualExitPrice:
        matchedClosedPnl.exitPrice ?? trade.actualExitPrice ?? null,
      exitTimestamp: matchedClosedPnl.closedAt,
      exitType: trade.exitType ?? null,
      openFee: matchedClosedPnl.openFee ?? trade.openFee ?? null,
      closeFee: matchedClosedPnl.closeFee ?? trade.closeFee ?? null,
      fundingFee: matchedClosedPnl.fundingFee ?? trade.fundingFee ?? null,
      totalFee: matchedClosedPnl.totalFee ?? trade.totalFee ?? null,
      lastSyncedAt: endTime,
    };

    await Promise.all([
      store.saveTrade({ userName, trade: nextTrade, expire: TTL_1M }),
      store.saveClosedTrade({ userName, trade: nextTrade, expire: TTL_1M }),
      ...(isCurrentActiveTrade
        ? [
            store.deleteActiveTrade({
              userName,
              symbol: trade.symbol,
              scopeId,
            }),
          ]
        : []),
    ]);
    syncedTrades.push(nextTrade);
  }

  return syncedTrades;
};
