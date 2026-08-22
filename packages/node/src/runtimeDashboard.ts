import { getRuntimeStorageDayKeys } from '@tradejs/core/time';
import { logger } from '@tradejs/infra/logger';
import {
  listTradingAccounts,
  resolveTradingAccount,
} from '@tradejs/infra/tradingAccounts';
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
  RuntimeStrategiesResponse,
  StrategyConfig,
  RuntimeStrategyControlState,
  RuntimeStrategySelection,
} from '@tradejs/types';
import { getConnectorCreatorByProvider } from './connectorsRegistry';
import {
  buildRuntimeStrategyAnalytics,
  isRuntimeTradeRecord,
  selectTradesForWindow,
  toRuntimeTradeView,
  buildRuntimeStrategyIdentityKey,
} from '@tradejs/core/runtimeTrades';
import {
  isRuntimeTradeInConnectorScope,
  syncRuntimeTrades,
} from './runtimeTradeSync';
import { buildExchangeFallbackRuntimeTrades } from './runtimeTrades';
import {
  listRuntimeDeployments,
  loadResolvedRuntimeStrategies,
} from './runtimeStrategies';

const DEFAULT_PROVIDER = 'bybit';
const DEFAULT_HOURS = 168;
const MIN_HOURS = 6;
const MAX_HOURS = 24 * 90;
const BYBIT_MAX_TIME_RANGE_MS = 7 * 24 * 60 * 60 * 1000 - 1_000;
const EXCHANGE_REQUEST_TIMEOUT_MS = 15_000;

const coerceHours = (value: string | number | null | undefined) => {
  const parsed = Number(value ?? Number.NaN);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_HOURS;
  }

  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.trunc(parsed)));
};

const resolveConnectorCreatorByProvider = async (
  provider: string,
  projectRoot: string,
) =>
  (await getConnectorCreatorByProvider(provider, projectRoot)) ??
  (await getConnectorCreatorByProvider(DEFAULT_PROVIDER, projectRoot)) ??
  null;

const resolveConnectorAccountId = async ({
  userName,
  provider,
}: {
  userName: string;
  provider: string;
}) =>
  (
    await resolveTradingAccount({
      userName,
      provider,
      universe: 'crypto',
    })
  )?.id;

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
  const [bucketTradeGroups, legacyKeys] = await Promise.all([
    Promise.all(
      dayKeys.map((dayKey) =>
        getHashJsonValues<RuntimeTradeRecord>(
          redisKeys.runtimeTradeBucket(userName, dayKey),
        ),
      ),
    ),
    getKeys(redisKeys.runtimeTrades(userName)),
  ]);
  const legacyTradeKeys = legacyKeys.filter(
    (key) => !key.startsWith(redisKeys.runtimeTradeBuckets(userName)),
  );
  const legacyTrades = await Promise.all(
    legacyTradeKeys.map((key) => getData(key, null)),
  );
  const dedupedTrades = new Map<string, RuntimeTradeRecord>();

  for (const trade of [...legacyTrades, ...bucketTradeGroups.flat()]) {
    if (!isRuntimeTradeRecord(trade)) {
      continue;
    }
    const existing = dedupedTrades.get(trade.orderId);
    if (
      !existing ||
      (trade.lastSyncedAt ?? Number.NEGATIVE_INFINITY) >=
        (existing.lastSyncedAt ?? Number.NEGATIVE_INFINITY)
    ) {
      dedupedTrades.set(trade.orderId, trade);
    }
  }

  return [...dedupedTrades.values()]
    .filter(filterByWindow)
    .sort((left, right) => left.entryTimestamp - right.entryTimestamp);
};

const getTradeStrategyRevision = (trade: RuntimeTradeRecord) =>
  trade.strategyRevision ??
  (trade.runtimeLineage?.schemaVersion === 3
    ? trade.runtimeLineage.strategyRevision
    : undefined);

const buildStrategyRevisionChanges = (trades: RuntimeTradeRecord[]) => {
  const changes: Array<{ timestamp: number; strategyRevision: string }> = [];
  let previousRevision: string | undefined;

  for (const trade of [...trades].sort(
    (left, right) =>
      left.entryTimestamp - right.entryTimestamp ||
      left.orderId.localeCompare(right.orderId),
  )) {
    const strategyRevision = getTradeStrategyRevision(trade);
    if (!strategyRevision) continue;
    if (previousRevision && strategyRevision !== previousRevision) {
      changes.push({
        timestamp: trade.entryTimestamp,
        strategyRevision,
      });
    }
    previousRevision = strategyRevision;
  }

  return changes;
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

export interface RuntimeDashboardQuery {
  userName: string;
  provider?: string | null;
  hours?: string | number | null;
  now?: number;
  projectRoot?: string;
}

export const loadRuntimeDashboard = async ({
  userName,
  provider: requestedProvider,
  hours: requestedHours,
  now,
  projectRoot: requestedProjectRoot,
}: RuntimeDashboardQuery): Promise<RuntimeStrategiesResponse> => {
  const provider = requestedProvider?.trim() || DEFAULT_PROVIDER;
  const hours = coerceHours(requestedHours);
  const endTime = now ?? Date.now();
  const startTime = endTime - hours * 60 * 60 * 1000;
  const projectRoot =
    requestedProjectRoot?.trim() ||
    String(process.env.PROJECT_CWD || process.cwd()).trim() ||
    process.cwd();
  const exchangeErrors: string[] = [];
  const connectorCreator = await resolveConnectorCreatorByProvider(
    provider,
    projectRoot,
  );

  if (!connectorCreator) {
    throw new Error(`No connector available for provider "${provider}"`);
  }

  const connectorAccountId = await resolveConnectorAccountId({
    userName,
    provider,
  });
  const connector = await connectorCreator({
    userName,
    accountId: connectorAccountId,
    universe: 'crypto',
  });

  const [
    runtimeTrades,
    activeOrderIds,
    closedPnlRows,
    entryRows,
    openPositionsSnapshot,
    runtimeDeployments,
    tradingAccounts,
  ] = await Promise.all([
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
    listRuntimeDeployments({ userName, projectRoot }),
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
    ...new Set(
      runtimeDeployments.flatMap((deployment) =>
        deployment.strategies.map(({ strategyName }) => strategyName),
      ),
    ),
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
  const accountsById = new Map(
    tradingAccounts.map((account) => [account.id, account]),
  );
  const resolvedStrategiesByDeployment = new Map(
    await Promise.all(
      runtimeDeployments.map(
        async (deployment) =>
          [
            deployment.id,
            await loadResolvedRuntimeStrategies({
              userName,
              projectRoot,
              deploymentId: deployment.id,
            }),
          ] as const,
      ),
    ),
  );
  const identityByKey = new Map<
    string,
    {
      strategyName: string;
      configId: string;
      interval: Interval;
      universe: 'crypto' | 'tradfi';
      accountId?: string;
      accountLabel?: string;
      deploymentId: string;
      policyProfileId?: string;
      strategyRevision: string;
      controlState: RuntimeStrategyControlState;
      enabled: boolean;
      config: StrategyConfig;
      connected: boolean;
      selection?: RuntimeStrategySelection;
    }
  >();
  for (const deployment of runtimeDeployments) {
    for (const resolvedStrategy of resolvedStrategiesByDeployment.get(
      deployment.id,
    ) ?? []) {
      const strategyUniverse = resolvedStrategy.universe;
      const strategyInterval = resolvedStrategy.interval;
      const strategyConfigId = resolvedStrategy.strategyRevision;
      const strategyPolicyProfileId =
        typeof resolvedStrategy.strategyConfig.POLICY_PROFILE_ID === 'string'
          ? resolvedStrategy.strategyConfig.POLICY_PROFILE_ID
          : undefined;
      const runtimeKey = buildRuntimeStrategyIdentityKey({
        strategyName: resolvedStrategy.strategyName,
        configId: strategyConfigId,
        universe: strategyUniverse,
        accountId: deployment.accountId,
        deploymentId: deployment.id,
        policyProfileId: strategyPolicyProfileId,
      });
      identityByKey.set(runtimeKey, {
        strategyName: resolvedStrategy.strategyName,
        configId: strategyConfigId,
        strategyRevision: resolvedStrategy.strategyRevision,
        controlState: resolvedStrategy.controlState,
        interval: strategyInterval,
        universe: strategyUniverse,
        accountId: deployment.accountId,
        accountLabel: accountsById.get(deployment.accountId)?.label,
        deploymentId: deployment.id,
        policyProfileId: strategyPolicyProfileId,
        enabled: resolvedStrategy.controlState !== 'entries_paused',
        config: resolvedStrategy.strategyConfig,
        connected: deployment.enabled,
        ...(resolvedStrategy.selection
          ? { selection: resolvedStrategy.selection }
          : {}),
      });
    }
  }
  const strategies = await Promise.all(
    [...identityByKey.entries()].map(async ([runtimeKey, identity]) => {
      const { strategyName } = identity;
      const strategyTrades = allTrades
        .filter(
          (trade) =>
            trade.strategy === strategyName &&
            String(trade.interval) === String(identity.interval),
        )
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
      const effectiveStrategyConfig = identity.config;

      return {
        runtimeKey,
        strategyName,
        configId: identity.configId,
        strategyRevision: identity.strategyRevision,
        controlState: identity.controlState,
        interval: identity.interval,
        universe: identity.universe,
        accountId: identity.accountId,
        accountLabel: identity.accountLabel,
        deploymentId: identity.deploymentId,
        ...(identity.selection ? { selection: identity.selection } : {}),
        policyProfileId: identity.policyProfileId,
        connected: identity.connected,
        enabled: identity.enabled,
        config: effectiveStrategyConfig,
        symbols: [...new Set(strategyTrades.map((trade) => trade.symbol))],
        stat: analytics.stat,
        summary: analytics.summary,
        orderLog: analytics.orderLog,
        revisionChanges: buildStrategyRevisionChanges(strategyTrades),
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

  return response;
};
