import { NextRequest, NextResponse } from 'next/server';
import { TTL_1M } from '@tradejs/core/constants';
import { getConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { logger } from '@tradejs/infra/logger';
import {
  delKey,
  getData,
  getKeys,
  redisKeys,
  setData,
} from '@tradejs/infra/redis';
import type {
  Connector,
  ConnectorCreator,
  Interval,
  RuntimeTradeRecord,
} from '@tradejs/types';
import { getCurrentUserName } from '@app/lib/currentUser';
import {
  buildRuntimeStrategyStats,
  buildStrategyTradeMarkers,
  isRuntimeTradeRecord,
  resolveStrategyNameByConfigKey,
  RuntimeStrategiesResponse,
  RuntimeStrategyTradeView,
  takeClosedPnlMatch,
  selectFocusSymbol,
  selectTradesForWindow,
} from '@app/lib/runtimeStrategies';

type ClosedPnlRecordWithOrderLinkId = Awaited<
  ReturnType<NonNullable<Connector['getClosedPnl']>>
>[number] & {
  orderLinkId?: string;
};

export const dynamic = 'force-dynamic';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const DEFAULT_PROVIDER = 'bybit';
const DEFAULT_HOURS = 168;
const MIN_HOURS = 6;
const MAX_HOURS = 24 * 30;

const coerceHours = (value: string | null) => {
  const parsed = Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HOURS;
  }

  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.trunc(parsed)));
};

const chartIntervalForHours = (hours: number): Interval =>
  hours <= 72 ? '15' : '60';

const loadConnectedStrategyNames = async (userName: string) => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  const names = keys
    .filter((key) => key.endsWith(':config'))
    .map((key) => resolveStrategyNameByConfigKey(userName, key))
    .filter((value): value is string => Boolean(value));

  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
};

const loadRuntimeTrades = async (
  userName: string,
): Promise<RuntimeTradeRecord[]> => {
  const keys = await getKeys(redisKeys.runtimeTrades(userName));
  const trades = await Promise.all(keys.map((key) => getData(key, null)));

  return trades
    .filter(isRuntimeTradeRecord)
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

const loadClosedPnlRows = async ({
  connector,
  startTime,
  endTime,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
}) => {
  if (typeof connector.getClosedPnl !== 'function') {
    return [];
  }

  try {
    const rows = await connector.getClosedPnl({
      startTime,
      endTime,
      limit: 100,
    });

    return rows.sort((left, right) => left.closedAt - right.closedAt);
  } catch (error) {
    logger.warn(
      'strategies runtime: getClosedPnl failed: %s',
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

const syncRuntimeTrades = async ({
  userName,
  connector,
  trades,
  startTime,
  endTime,
}: {
  userName: string;
  connector: Connector;
  trades: RuntimeTradeRecord[];
  startTime: number;
  endTime: number;
}) => {
  const openPositions =
    typeof connector.getOpenPositionPnl === 'function'
      ? await connector.getOpenPositionPnl()
      : [];
  const openPositionsBySymbol = new Map(
    openPositions.map((position) => [position.symbol, position]),
  );
  const activeOrderIdBySymbol = new Map<string, string | null>();
  const symbols = [...new Set(trades.map((trade) => trade.symbol))];

  await Promise.all(
    symbols.map(async (symbol) => {
      const activeRef = (await getData(
        redisKeys.runtimeActiveTrade(userName, symbol),
        null,
      )) as { orderId?: string } | null;
      activeOrderIdBySymbol.set(
        symbol,
        typeof activeRef?.orderId === 'string' ? activeRef.orderId : null,
      );
    }),
  );

  const closedPnlRows = await loadClosedPnlRows({
    connector,
    startTime,
    endTime,
  });
  const closedPnlRowsWithOrderLinkId =
    closedPnlRows as ClosedPnlRecordWithOrderLinkId[];
  const exactByOrderLinkId = new Map(
    closedPnlRowsWithOrderLinkId
      .filter(
        (row): row is typeof row & { orderLinkId: string } =>
          typeof row.orderLinkId === 'string' && row.orderLinkId.length > 0,
      )
      .map((row) => [row.orderLinkId, row]),
  );
  const symbolBuckets = new Map<string, ClosedPnlRecordWithOrderLinkId[]>();

  for (const row of closedPnlRowsWithOrderLinkId) {
    const bucket = symbolBuckets.get(row.symbol) ?? [];
    bucket.push(row);
    symbolBuckets.set(row.symbol, bucket);
  }

  const syncedTrades: RuntimeTradeRecord[] = [];

  for (const trade of trades) {
    if (trade.status !== 'active') {
      syncedTrades.push(trade);
      continue;
    }

    const openPosition = openPositionsBySymbol.get(trade.symbol);
    const activeOrderId = activeOrderIdBySymbol.get(trade.symbol);
    const isCurrentActiveTrade = activeOrderId === trade.orderId;

    if (
      isCurrentActiveTrade &&
      openPosition &&
      openPosition.direction === trade.direction
    ) {
      const nextTrade: RuntimeTradeRecord = {
        ...trade,
        status: 'active',
        currentPrice: openPosition.currentPrice,
        currentPnl: openPosition.unrealizedPnl,
        lastSyncedAt: endTime,
      };

      await setData(
        redisKeys.runtimeTrade(userName, trade.orderId),
        nextTrade,
        {
          expire: 0,
        },
      );
      syncedTrades.push(nextTrade);
      continue;
    }

    const matchedClosedPnl = takeClosedPnlMatch({
      exactByOrderLinkId,
      symbolBuckets,
      trade,
    });
    const nextTrade: RuntimeTradeRecord = {
      ...trade,
      status: 'closed',
      currentPrice: matchedClosedPnl?.exitPrice ?? trade.currentPrice ?? null,
      currentPnl:
        matchedClosedPnl?.closedPnl ??
        trade.closedPnl ??
        trade.currentPnl ??
        null,
      closedPnl:
        matchedClosedPnl?.closedPnl ??
        trade.closedPnl ??
        trade.currentPnl ??
        null,
      exitPrice: matchedClosedPnl?.exitPrice ?? trade.exitPrice ?? null,
      exitTimestamp:
        matchedClosedPnl?.closedAt ?? trade.exitTimestamp ?? endTime,
      lastSyncedAt: endTime,
    };

    await Promise.all([
      setData(redisKeys.runtimeTrade(userName, trade.orderId), nextTrade, {
        expire: TTL_1M,
      }),
      ...(isCurrentActiveTrade
        ? [delKey(redisKeys.runtimeActiveTrade(userName, trade.symbol))]
        : []),
    ]);
    syncedTrades.push(nextTrade);
  }

  return syncedTrades;
};

const toTradeView = (trade: RuntimeTradeRecord): RuntimeStrategyTradeView => ({
  orderId: trade.orderId,
  symbol: trade.symbol,
  direction: trade.direction,
  status: trade.status,
  entryTimestamp: trade.entryTimestamp,
  entryPrice: trade.entryPrice,
  exitTimestamp:
    typeof trade.exitTimestamp === 'number' ? trade.exitTimestamp : null,
  exitPrice: typeof trade.exitPrice === 'number' ? trade.exitPrice : null,
  pnl:
    trade.status === 'closed'
      ? trade.closedPnl ?? trade.currentPnl ?? null
      : trade.currentPnl ?? null,
  lastSyncedAt:
    typeof trade.lastSyncedAt === 'number' ? trade.lastSyncedAt : null,
});

const loadStrategyChart = async ({
  connector,
  symbol,
  startTime,
  endTime,
  hours,
}: {
  connector: Connector;
  symbol: string | null;
  startTime: number;
  endTime: number;
  hours: number;
}) => {
  if (!symbol) {
    return [];
  }

  try {
    const rows = await connector.kline({
      symbol,
      interval: chartIntervalForHours(hours),
      start: startTime,
      end: endTime,
      silent: true,
    });

    return rows.map((row) => ({
      timestamp: row.timestamp,
      close: row.close,
    }));
  } catch (error) {
    logger.warn(
      'strategies runtime: kline failed for %s: %s',
      symbol,
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

export const GET = async (request: NextRequest) => {
  try {
    const userName = await getCurrentUserName();
    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const provider =
      request.nextUrl.searchParams.get('provider')?.trim() || DEFAULT_PROVIDER;
    const hours = coerceHours(request.nextUrl.searchParams.get('hours'));
    const endTime = Date.now();
    const startTime = endTime - hours * 60 * 60 * 1000;
    const connectorCreator =
      (await getConnectorCreatorByProvider(provider, projectRoot)) ||
      (await getConnectorCreatorByProvider(DEFAULT_PROVIDER, projectRoot));

    if (!connectorCreator) {
      throw new Error(`No connector available for provider "${provider}"`);
    }

    const connector = await (connectorCreator as ConnectorCreator)({
      userName,
    });

    const [connectedStrategyNames, runtimeTrades] = await Promise.all([
      loadConnectedStrategyNames(userName),
      loadRuntimeTrades(userName),
    ]);
    const relevantTrades = selectTradesForWindow(runtimeTrades, startTime);
    const syncedTrades = await syncRuntimeTrades({
      userName,
      connector,
      trades: relevantTrades,
      startTime,
      endTime,
    });
    const connectedSet = new Set(connectedStrategyNames);
    const strategyNames = [
      ...new Set([
        ...connectedStrategyNames,
        ...syncedTrades.map((trade) => trade.strategy).filter(Boolean),
      ]),
    ];

    const strategies = await Promise.all(
      strategyNames.map(async (strategyName) => {
        const strategyTrades = syncedTrades
          .filter((trade) => trade.strategy === strategyName)
          .sort((left, right) => right.entryTimestamp - left.entryTimestamp);
        const focusSymbol = selectFocusSymbol(strategyTrades);
        const chart = await loadStrategyChart({
          connector,
          symbol: focusSymbol,
          startTime,
          endTime,
          hours,
        });

        return {
          strategyName,
          connected: connectedSet.has(strategyName),
          symbols: [...new Set(strategyTrades.map((trade) => trade.symbol))],
          focusSymbol,
          stats: buildRuntimeStrategyStats(strategyTrades),
          chart,
          markers: focusSymbol
            ? buildStrategyTradeMarkers(strategyTrades, focusSymbol)
            : [],
          recentTrades: strategyTrades.slice(0, 8).map(toTradeView),
        };
      }),
    );

    strategies.sort((left, right) => {
      if (left.connected !== right.connected) {
        return left.connected ? -1 : 1;
      }
      if (left.stats.activeTrades !== right.stats.activeTrades) {
        return right.stats.activeTrades - left.stats.activeTrades;
      }
      if (left.stats.totalPnl !== right.stats.totalPnl) {
        return right.stats.totalPnl - left.stats.totalPnl;
      }
      return left.strategyName.localeCompare(right.strategyName);
    });

    const response: RuntimeStrategiesResponse = {
      provider,
      hours,
      generatedAt: endTime,
      strategies,
    };

    return NextResponse.json(response);
  } catch (error) {
    logger.error('strategies runtime route failed: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
