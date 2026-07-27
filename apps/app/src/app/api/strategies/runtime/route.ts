import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeStorageDayKeys } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  listRuntimeDeployments,
  listTradingAccounts,
  resolveTradingAccount,
} from '@tradejs/infra/tradingAccounts';
import { strategyEntries } from '@tradejs/strategies';
import {
  getData,
  getHashJsonValues,
  getKeys,
  redisKeys,
} from '@tradejs/infra/redis';
import type {
  Connector,
  RuntimeTradeRecord,
  Interval,
  StrategyConfig,
} from '@tradejs/types';
import { getAvailableStrategyNames } from '@tradejs/node/strategies';
import {
  DEFAULT_CONNECTOR_PROVIDER,
  resolveConnectorAccountId,
  resolveConnectorCreatorByProvider,
} from '#app/lib/connectorCreator';
import { getCurrentUserName } from '#app/lib/currentUser';
import {
  assignLegacyRuntimeTradeAccountScopes,
  buildRuntimeStrategyAnalytics,
  buildRuntimeStrategyIdentityKey,
  buildExchangeFallbackRuntimeTrades,
  isRuntimeTradeRecord,
  resolveStrategyConfigIdentityByKey,
  RuntimeStrategiesResponse,
  selectTradesForWindow,
  toRuntimeTradeView,
} from '#app/lib/runtimeStrategies';
import {
  isRuntimeTradeInConnectorScope,
  syncRuntimeTrades,
} from '#app/lib/runtimeTradeSync';

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

const isRuntimeStrategyConfigEnabled = (config: StrategyConfig | null) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }

  return (config as Record<string, unknown>).ENABLE !== false;
};

const loadRuntimeStrategyConfigs = async (userName: string) => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  const entries = await Promise.all(
    keys.map(async (key) => {
      const identity = resolveStrategyConfigIdentityByKey(userName, key);
      if (!identity) {
        return null;
      }

      const config = (await getData(key, null)) as StrategyConfig | null;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return null;
      }

      return { ...identity, key, config };
    }),
  );
  return entries.filter(
    (entry): entry is NonNullable<typeof entry> => entry != null,
  );
};

const loadConfiguredStrategyNames = async () => {
  try {
    const names = await getAvailableStrategyNames(projectRoot);
    const builtInNames = strategyEntries
      .map((entry) => entry.manifest?.name)
      .filter((value): value is string => Boolean(value));

    return [...new Set([...names, ...builtInNames])].sort((left, right) =>
      left.localeCompare(right),
    );
  } catch (error) {
    logger.warn(
      'strategies runtime: failed to load configured strategies: %s',
      (error as Error)?.message || String(error),
    );
    return strategyEntries
      .map((entry) => entry.manifest?.name)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right));
  }
};

const loadRuntimeTrades = async (
  userName: string,
  {
    startTime,
    endTime,
  }: {
    startTime: number;
    endTime: number;
  },
): Promise<RuntimeTradeRecord[]> => {
  const filterByWindow = (trade: RuntimeTradeRecord) =>
    trade.entryTimestamp >= startTime ||
    (typeof trade.exitTimestamp === 'number' &&
      trade.exitTimestamp >= startTime);
  const dayKeys = getRuntimeStorageDayKeys(startTime, endTime);
  const bucketTrades = (
    await Promise.all(
      dayKeys.map((dayKey) =>
        getHashJsonValues<RuntimeTradeRecord>(
          redisKeys.runtimeTradeBucket(userName, dayKey),
        ),
      ),
    )
  ).flat();
  const dedupedBucketTrades = new Map<string, RuntimeTradeRecord>();

  for (const trade of bucketTrades) {
    if (!isRuntimeTradeRecord(trade)) {
      continue;
    }
    dedupedBucketTrades.set(trade.orderId, trade);
  }

  if (dedupedBucketTrades.size > 0 || dayKeys.length === 0) {
    return [...dedupedBucketTrades.values()]
      .filter(filterByWindow)
      .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
  }

  const keys = await getKeys(redisKeys.runtimeTrades(userName));
  const trades = await Promise.all(keys.map((key) => getData(key, null)));

  return trades
    .filter(isRuntimeTradeRecord)
    .filter(filterByWindow)
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
  errors,
}: {
  label: string;
  startTime: number;
  endTime: number;
  load: () => Promise<T[]>;
  errors?: string[];
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
    const message = (error as Error)?.message || String(error);
    errors?.push(`${label}: ${message}`);
    logger.warn('strategies runtime: %s failed: %s', label, message);
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
  errors,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
  errors?: string[];
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
            errors,
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
    const message = (error as Error)?.message || String(error);
    errors?.push(`getClosedPnl: ${message}`);
    logger.warn('strategies runtime: getClosedPnl failed: %s', message);
    return [];
  }
};

const loadExchangeEntryRows = async ({
  connector,
  startTime,
  endTime,
  errors,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
  errors?: string[];
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
            errors,
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
    const message = (error as Error)?.message || String(error);
    errors?.push(`getEntryExecutions: ${message}`);
    logger.warn('strategies runtime: getEntryExecutions failed: %s', message);
    return [];
  }
};

const loadOpenPositions = async (
  connector: Connector,
  errors?: string[],
): Promise<{
  positions: Awaited<ReturnType<NonNullable<Connector['getOpenPositionPnl']>>>;
  reliable: boolean;
}> => {
  if (typeof connector.getOpenPositionPnl !== 'function') {
    return { positions: [], reliable: false };
  }

  try {
    return {
      positions: await connector.getOpenPositionPnl(),
      reliable: true,
    };
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    errors?.push(`getOpenPositionPnl: ${message}`);
    logger.warn('strategies runtime: getOpenPositionPnl failed: %s', message);
    return { positions: [], reliable: false };
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
    const exchangeErrors: string[] = [];
    const connectorCreator = await resolveConnectorCreatorByProvider(
      provider,
      projectRoot,
      DEFAULT_PROVIDER,
    );

    if (!connectorCreator) {
      throw new Error(`No connector available for provider "${provider}"`);
    }

    const connectorAccountId = await resolveConnectorAccountId({
      userName,
      provider,
      universe: 'crypto',
    });
    const connector = await connectorCreator({
      userName,
      accountId: connectorAccountId,
      universe: 'crypto',
    });

    const [
      runtimeStrategyConfigs,
      configuredStrategyNames,
      runtimeTrades,
      activeOrderIds,
      closedPnlRows,
      entryRows,
      openPositionsSnapshot,
      runtimeDeployments,
      tradingAccounts,
    ] = await Promise.all([
      loadRuntimeStrategyConfigs(userName),
      loadConfiguredStrategyNames(),
      loadRuntimeTrades(userName, { startTime, endTime }),
      loadActiveRuntimeOrderIds(userName),
      loadClosedPnlRows({
        connector,
        startTime,
        endTime,
        errors: exchangeErrors,
      }),
      loadExchangeEntryRows({
        connector,
        startTime,
        endTime,
        errors: exchangeErrors,
      }),
      loadOpenPositions(connector, exchangeErrors),
      listRuntimeDeployments(userName),
      listTradingAccounts(userName),
    ]);
    const relevantTrades = selectTradesForWindow(
      runtimeTrades,
      startTime,
      activeOrderIds,
    );
    const syncableTrades = relevantTrades.filter((trade) =>
      isRuntimeTradeInConnectorScope(trade, connector),
    );
    const unsyncedTrades = relevantTrades.filter(
      (trade) => !isRuntimeTradeInConnectorScope(trade, connector),
    );
    const syncedConnectorTrades = await syncRuntimeTrades({
      userName,
      connector,
      trades: syncableTrades,
      endTime,
      openPositions: openPositionsSnapshot.positions,
      openPositionsReliable: openPositionsSnapshot.reliable,
      closedPnlRows,
    });
    const syncedTrades = [...unsyncedTrades, ...syncedConnectorTrades];
    const fallbackStrategyNames = [
      ...new Set([
        ...runtimeStrategyConfigs.map(({ strategyName }) => strategyName),
        ...configuredStrategyNames,
      ]),
    ];
    const fallbackTrades = buildExchangeFallbackRuntimeTrades({
      entryRows,
      closedPnlRows,
      openPositions: openPositionsSnapshot.positions,
      strategyNames: fallbackStrategyNames,
      existingTrades: syncedTrades,
      endTime,
    });
    const allTrades = [...syncedTrades, ...fallbackTrades].filter(
      isRuntimeTradeRecord,
    );
    const connectedSet = new Set(
      runtimeStrategyConfigs.map(
        ({ strategyName, configId }) => `${strategyName}:${configId}`,
      ),
    );
    const accountsById = new Map(
      tradingAccounts.map((account) => [account.id, account]),
    );
    const runtimeIdentityKey = (trade: RuntimeTradeRecord) =>
      buildRuntimeStrategyIdentityKey({
        strategyName: trade.strategy,
        configId: trade.runtimeConfigId,
        universe: trade.universe,
        accountId: trade.accountId,
        deploymentId: trade.deploymentId,
        policyProfileId: trade.policyProfileId,
      });
    const identityByKey = new Map<
      string,
      {
        strategyName: string;
        configId: string;
        interval: Interval;
        universe: 'crypto' | 'tradfi';
        accountId?: string;
        accountLabel?: string;
        deploymentId?: string;
        policyProfileId?: string;
        enabled?: boolean;
        config?: Record<string, unknown>;
        connected?: boolean;
      }
    >();
    const runtimeConfigAccountScopes = new Array<{
      strategyName: string;
      configId: string;
      universe: 'crypto' | 'tradfi';
      accountId?: string;
    }>();
    for (const deployment of runtimeDeployments) {
      for (const deploymentStrategy of deployment.strategies) {
        const runtimeKey = buildRuntimeStrategyIdentityKey({
          strategyName: deploymentStrategy.strategyName,
          configId: `deployment-${deployment.id}`,
          universe: deployment.universe,
          accountId: deployment.accountId,
          deploymentId: deployment.id,
          policyProfileId: deploymentStrategy.policyProfileId,
        });
        identityByKey.set(runtimeKey, {
          strategyName: deploymentStrategy.strategyName,
          configId: `deployment-${deployment.id}`,
          interval: String(deployment.interval) as Interval,
          universe: deployment.universe,
          accountId: deployment.accountId,
          accountLabel: accountsById.get(deployment.accountId)?.label,
          deploymentId: deployment.id,
          policyProfileId: deploymentStrategy.policyProfileId,
          enabled: deployment.enabled && deploymentStrategy.enabled !== false,
          config: deploymentStrategy.config,
          connected: false,
        });
      }
    }
    for (const runtimeConfig of runtimeStrategyConfigs) {
      const universe =
        runtimeConfig.config.UNIVERSE === 'tradfi' ? 'tradfi' : 'crypto';
      const configuredAccountId =
        typeof runtimeConfig.config.ACCOUNT_ID === 'string' &&
        runtimeConfig.config.ACCOUNT_ID.trim()
          ? runtimeConfig.config.ACCOUNT_ID.trim()
          : undefined;
      const resolvedAccount = await resolveTradingAccount({
        userName,
        accountId: configuredAccountId,
        provider,
        universe,
      }).catch(() => null);
      const accountId = resolvedAccount?.id ?? configuredAccountId;
      runtimeConfigAccountScopes.push({
        strategyName: runtimeConfig.strategyName,
        configId: runtimeConfig.configId,
        universe,
        accountId,
      });
      const runtimeKey = buildRuntimeStrategyIdentityKey({
        strategyName: runtimeConfig.strategyName,
        configId: runtimeConfig.configId,
        universe,
        accountId,
      });
      identityByKey.set(runtimeKey, {
        strategyName: runtimeConfig.strategyName,
        configId: runtimeConfig.configId,
        interval: String(runtimeConfig.config.INTERVAL ?? '15') as Interval,
        universe,
        accountId,
        accountLabel: accountId
          ? accountsById.get(accountId)?.label
          : undefined,
        enabled: isRuntimeStrategyConfigEnabled(runtimeConfig.config),
        config: runtimeConfig.config,
        connected: true,
      });
    }
    const accountScopedTrades = assignLegacyRuntimeTradeAccountScopes(
      allTrades,
      runtimeConfigAccountScopes,
    );
    for (const trade of accountScopedTrades) {
      const key = runtimeIdentityKey(trade);
      identityByKey.set(key, {
        ...identityByKey.get(key),
        strategyName: trade.strategy,
        configId: trade.runtimeConfigId ?? 'config',
        interval: String(trade.interval ?? '15') as Interval,
        universe: trade.universe ?? 'crypto',
        accountId: trade.accountId,
        accountLabel: trade.accountId
          ? accountsById.get(trade.accountId)?.label
          : undefined,
        deploymentId: trade.deploymentId,
        policyProfileId: trade.policyProfileId,
      });
    }

    const strategies = await Promise.all(
      [...identityByKey.entries()].map(async ([runtimeKey, identity]) => {
        const { strategyName } = identity;
        const strategyTrades = accountScopedTrades
          .filter((trade) => runtimeIdentityKey(trade) === runtimeKey)
          .sort((left, right) => right.entryTimestamp - left.entryTimestamp);
        const orders = strategyTrades
          .sort((left, right) => {
            const leftDate = left.exitTimestamp ?? left.entryTimestamp;
            const rightDate = right.exitTimestamp ?? right.entryTimestamp;

            return rightDate - leftDate;
          })
          .map((trade) => toRuntimeTradeView(trade, endTime));
        const analytics = buildRuntimeStrategyAnalytics({
          trades: strategyTrades,
          startTime,
          endTime,
        });
        const effectiveStrategyConfig = identity.config ?? null;

        return {
          runtimeKey,
          strategyName,
          configId: identity.configId,
          interval: identity.interval,
          universe: identity.universe,
          accountId: identity.accountId,
          accountLabel: identity.accountLabel,
          deploymentId: identity.deploymentId,
          policyProfileId: identity.policyProfileId,
          connected:
            identity.connected ??
            connectedSet.has(`${strategyName}:${identity.configId}`),
          enabled:
            identity.enabled ??
            isRuntimeStrategyConfigEnabled(effectiveStrategyConfig),
          config: effectiveStrategyConfig,
          symbols: [...new Set(strategyTrades.map((trade) => trade.symbol))],
          stat: analytics.stat,
          summary: analytics.summary,
          orderLog: analytics.orderLog,
          recentTrades: strategyTrades
            .slice(0, 8)
            .map((trade) => toRuntimeTradeView(trade, endTime)),
          orders,
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
      dataSources: {
        localTrades: syncedTrades.length,
        exchangeFallbackTrades: fallbackTrades.length,
        exchangeErrors: [...new Set(exchangeErrors)].sort(),
      },
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
