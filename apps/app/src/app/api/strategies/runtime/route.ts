import { NextRequest, NextResponse } from 'next/server';
import { TTL_1M } from '@tradejs/core/constants';
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
  PositionPnlSnapshot,
  RuntimeTradeRecord,
} from '@tradejs/types';
import { getAvailableStrategyNames } from '@tradejs/node/strategies';
import {
  DEFAULT_CONNECTOR_PROVIDER,
  resolveConnectorCreatorByProvider,
} from '#app/lib/connectorCreator';
import { getCurrentUserName } from '#app/lib/currentUser';
import {
  buildRuntimeStrategyAnalytics,
  buildExchangeFallbackRuntimeTrades,
  isRuntimeTradeRecord,
  resolveStrategyNameByConfigKey,
  RuntimeStrategiesResponse,
  selectTradesForWindow,
  takeClosedPnlMatch,
  toRuntimeTradeView,
} from '#app/lib/runtimeStrategies';

type ClosedPnlRecordWithOrderLinkId = Awaited<
  ReturnType<NonNullable<Connector['getClosedPnl']>>
>[number] & {
  orderLinkId?: string;
};

export const dynamic = 'force-dynamic';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const DEFAULT_PROVIDER = DEFAULT_CONNECTOR_PROVIDER;
const DEFAULT_HOURS = 168;
const MIN_HOURS = 6;
const MAX_HOURS = 24 * 90;
const BYBIT_MAX_TIME_RANGE_MS = 7 * 24 * 60 * 60 * 1000 - 1_000;
const EXCHANGE_REQUEST_TIMEOUT_MS = 15_000;

const coerceHours = (value: string | null) => {
  const parsed = Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HOURS;
  }

  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.trunc(parsed)));
};

const loadConnectedStrategyNames = async (userName: string) => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  const names = keys
    .filter((key) => key.endsWith(':config'))
    .map((key) => resolveStrategyNameByConfigKey(userName, key))
    .filter((value): value is string => Boolean(value));

  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
};

const loadConfiguredStrategyNames = async () => {
  try {
    return await getAvailableStrategyNames(projectRoot);
  } catch (error) {
    logger.warn(
      'strategies runtime: failed to load configured strategies: %s',
      (error as Error)?.message || String(error),
    );
    return [];
  }
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

const buildExchangeTimeRanges = (startTime: number, endTime: number) => {
  const ranges: Array<{ startTime: number; endTime: number }> = [];
  let cursor = startTime;

  while (cursor < endTime) {
    const rangeEnd = Math.min(endTime, cursor + BYBIT_MAX_TIME_RANGE_MS);
    ranges.push({ startTime: cursor, endTime: rangeEnd });
    cursor = rangeEnd + 1;
  }

  return ranges;
};

const loadExchangeRange = async <T>({
  label,
  startTime,
  endTime,
  load,
}: {
  label: string;
  startTime: number;
  endTime: number;
  load: () => Promise<T[]>;
}) => {
  try {
    return await Promise.race([
      load(),
      new Promise<T[]>((_, reject) => {
        setTimeout(
          () =>
            reject(
              new Error(
                `${label} timed out for ${new Date(startTime).toISOString()} - ${new Date(endTime).toISOString()}`,
              ),
            ),
          EXCHANGE_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    logger.warn(
      'strategies runtime: %s failed: %s',
      label,
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

const loadActiveRuntimeOrderIds = async (userName: string) => {
  const keys = await getKeys(redisKeys.runtimeActiveTrades(userName));
  const refs = await Promise.all(keys.map((key) => getData(key, null)));

  return new Set(
    refs
      .map((ref) =>
        typeof ref?.orderId === 'string' && ref.orderId.trim()
          ? ref.orderId.trim()
          : null,
      )
      .filter((value): value is string => Boolean(value)),
  );
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
    const rows = (
      await Promise.all(
        buildExchangeTimeRanges(startTime, endTime).map((range) =>
          loadExchangeRange({
            label: 'getClosedPnl',
            ...range,
            load: () =>
              connector.getClosedPnl?.({
                ...range,
                limit: 100,
              }) ?? Promise.resolve([]),
          }),
        ),
      )
    ).flatMap((items) => items ?? []);

    return rows.sort((left, right) => left.closedAt - right.closedAt);
  } catch (error) {
    logger.warn(
      'strategies runtime: getClosedPnl failed: %s',
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

const loadExchangeEntryRows = async ({
  connector,
  startTime,
  endTime,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
}) => {
  if (typeof connector.getEntryExecutions !== 'function') {
    return [];
  }

  try {
    const rows = (
      await Promise.all(
        buildExchangeTimeRanges(startTime, endTime).map((range) =>
          loadExchangeRange({
            label: 'getEntryExecutions',
            ...range,
            load: () =>
              connector.getEntryExecutions?.({
                ...range,
                limit: 100,
              }) ?? Promise.resolve([]),
          }),
        ),
      )
    ).flatMap((items) => items ?? []);

    return rows.sort(
      (left, right) => left.entryTimestamp - right.entryTimestamp,
    );
  } catch (error) {
    logger.warn(
      'strategies runtime: getEntryExecutions failed: %s',
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

const loadOpenPositions = async (
  connector: Connector,
): Promise<PositionPnlSnapshot[]> => {
  if (typeof connector.getOpenPositionPnl !== 'function') {
    return [];
  }

  try {
    return await connector.getOpenPositionPnl();
  } catch (error) {
    logger.warn(
      'strategies runtime: getOpenPositionPnl failed: %s',
      (error as Error)?.message || String(error),
    );
    return [];
  }
};

const syncRuntimeTrades = async ({
  userName,
  trades,
  endTime,
  openPositions,
  closedPnlRows,
}: {
  userName: string;
  trades: RuntimeTradeRecord[];
  endTime: number;
  openPositions: PositionPnlSnapshot[];
  closedPnlRows: ClosedPnlRecordWithOrderLinkId[];
}) => {
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
    const connectorCreator = await resolveConnectorCreatorByProvider(
      provider,
      projectRoot,
      DEFAULT_PROVIDER,
    );

    if (!connectorCreator) {
      throw new Error(`No connector available for provider "${provider}"`);
    }

    const connector = await (connectorCreator as ConnectorCreator)({
      userName,
    });

    const [
      connectedStrategyNames,
      configuredStrategyNames,
      runtimeTrades,
      activeOrderIds,
      closedPnlRows,
      entryRows,
      openPositions,
    ] = await Promise.all([
      loadConnectedStrategyNames(userName),
      loadConfiguredStrategyNames(),
      loadRuntimeTrades(userName),
      loadActiveRuntimeOrderIds(userName),
      loadClosedPnlRows({
        connector,
        startTime,
        endTime,
      }),
      loadExchangeEntryRows({
        connector,
        startTime,
        endTime,
      }),
      loadOpenPositions(connector),
    ]);
    const relevantTrades = selectTradesForWindow(
      runtimeTrades,
      startTime,
      activeOrderIds,
    );
    const syncedTrades = await syncRuntimeTrades({
      userName,
      trades: relevantTrades,
      endTime,
      openPositions,
      closedPnlRows,
    });
    const fallbackStrategyNames = [
      ...new Set([...connectedStrategyNames, ...configuredStrategyNames]),
    ];
    const fallbackTrades = buildExchangeFallbackRuntimeTrades({
      entryRows,
      closedPnlRows,
      openPositions,
      strategyNames: fallbackStrategyNames,
      existingTrades: syncedTrades,
      endTime,
    });
    const allTrades = [...syncedTrades, ...fallbackTrades].filter(
      isRuntimeTradeRecord,
    );
    const connectedSet = new Set(connectedStrategyNames);
    const tradeStrategyNames = allTrades
      .map((trade) =>
        typeof trade?.strategy === 'string' && trade.strategy.trim()
          ? trade.strategy
          : null,
      )
      .filter((value): value is string => value != null);
    const strategyNames = [
      ...new Set([...connectedStrategyNames, ...tradeStrategyNames]),
    ];

    const strategies = await Promise.all(
      strategyNames.map(async (strategyName) => {
        const strategyTrades = allTrades
          .filter((trade) => trade.strategy === strategyName)
          .sort((left, right) => right.entryTimestamp - left.entryTimestamp);
        const analytics = buildRuntimeStrategyAnalytics({
          trades: strategyTrades,
          startTime,
          endTime,
        });

        return {
          strategyName,
          connected: connectedSet.has(strategyName),
          symbols: [...new Set(strategyTrades.map((trade) => trade.symbol))],
          stat: analytics.stat,
          summary: analytics.summary,
          orderLog: analytics.orderLog,
          recentTrades: strategyTrades.slice(0, 8).map(toRuntimeTradeView),
        };
      }),
    );

    strategies.sort((left, right) => {
      if (left.stat.netProfit !== right.stat.netProfit) {
        return right.stat.netProfit - left.stat.netProfit;
      }
      if (left.summary.totalPnl !== right.summary.totalPnl) {
        return right.summary.totalPnl - left.summary.totalPnl;
      }
      if (left.connected !== right.connected) {
        return left.connected ? -1 : 1;
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
