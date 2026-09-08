import type { ResolvedRuntimeStrategy } from '@tradejs/node/runtimeStrategies';
import type {
  Interval,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeStrategySelection,
  RuntimeTradeRecord,
} from '@tradejs/types';

export interface ConfiguredSignalsScope {
  connectorName: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
  strategyNames: string[];
  selection?: RuntimeStrategySelection;
}

interface ConfiguredSignalsScopeEntry {
  key: string;
  scope: ConfiguredSignalsScope;
}

const sorted = (values: readonly string[] | undefined) =>
  values ? [...values].sort() : [];

const normalizeSymbol = (value: string) => value.trim().toUpperCase();

const isActiveTradeInScope = ({
  trade,
  deploymentId,
  universe,
  accountId,
  interval,
}: {
  trade: RuntimeTradeRecord;
  deploymentId: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
}) =>
  trade.status === 'active' &&
  trade.deploymentId === deploymentId &&
  (trade.universe ?? 'crypto') === universe &&
  (!trade.accountId || trade.accountId === accountId) &&
  (!trade.interval || String(trade.interval) === String(interval));

const mergeConfiguredStrategySelections = (
  strategies: Array<Pick<ResolvedRuntimeStrategy, 'selection'>>,
): RuntimeStrategySelection | undefined => {
  if (strategies.some(({ selection }) => !selection)) {
    return undefined;
  }

  return {
    tickers: [
      ...new Set(
        strategies.flatMap(({ selection }) =>
          (selection?.tickers ?? []).map(normalizeSymbol),
        ),
      ),
    ].sort(),
  };
};

export const formatConfiguredStrategyIdentity = (
  strategy: Pick<
    ResolvedRuntimeStrategy,
    'strategyName' | 'strategyRevision' | 'controlState'
  >,
) =>
  `${strategy.strategyName}@${strategy.strategyRevision}[${strategy.controlState}]`;

export const getConfiguredScopeActiveSymbols = ({
  trades,
  deploymentId,
  strategyNames,
  universe,
  accountId,
  interval,
}: {
  trades: RuntimeTradeRecord[];
  deploymentId: string;
  strategyNames: string[];
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
}) => {
  const strategyNameSet = new Set(strategyNames);

  return [
    ...new Set(
      trades
        .filter(
          (trade) =>
            isActiveTradeInScope({
              trade,
              deploymentId,
              universe,
              accountId,
              interval,
            }) &&
            strategyNameSet.has(trade.strategy) &&
            Boolean(trade.symbol),
        )
        .map(({ symbol }) => normalizeSymbol(symbol)),
    ),
  ].sort();
};

export const createConfiguredStrategySymbolMatcher = ({
  trades,
  deploymentId,
  universe,
  accountId,
  interval,
}: {
  trades: RuntimeTradeRecord[];
  deploymentId: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
}) => {
  const activeStrategySymbols = new Set(
    trades
      .filter((trade) =>
        isActiveTradeInScope({
          trade,
          deploymentId,
          universe,
          accountId,
          interval,
        }),
      )
      .map(
        ({ strategy, symbol }) => `${strategy}\u0000${normalizeSymbol(symbol)}`,
      ),
  );

  return (
    strategy: Pick<ResolvedRuntimeStrategy, 'strategyName' | 'selection'>,
    symbol: string,
  ) => {
    if (!strategy.selection) return true;

    const normalizedSymbol = normalizeSymbol(symbol);
    return (
      strategy.selection.tickers.some((ticker) => {
        const normalizedTicker = normalizeSymbol(ticker);
        return (
          normalizedTicker === normalizedSymbol ||
          (universe === 'crypto' &&
            `${normalizedTicker}USDT` === normalizedSymbol)
        );
      }) ||
      activeStrategySymbols.has(
        `${strategy.strategyName}\u0000${normalizedSymbol}`,
      )
    );
  };
};

export const buildConfiguredSignalsScopes = ({
  connectorName,
  deployment,
  strategies,
}: {
  connectorName: string;
  deployment: RuntimeDeployment;
  strategies: ResolvedRuntimeStrategy[];
}): ConfiguredSignalsScopeEntry[] => {
  const deploymentIdentity = JSON.stringify({
    id: deployment.id,
    deploymentCompositionId: deployment.deploymentCompositionId,
    enabled: deployment.enabled,
    connectorName: deployment.connectorName,
    provider: deployment.provider,
    accountId: deployment.accountId,
    tickers: sorted(deployment.tickers),
    assetClasses: sorted(deployment.assetClasses),
  });
  const groups = new Map<
    string,
    {
      scope: ConfiguredSignalsScope;
      strategyIdentities: string[];
      strategies: ResolvedRuntimeStrategy[];
    }
  >();

  for (const strategy of strategies) {
    const baseKey = [
      connectorName,
      strategy.universe,
      strategy.accountId ?? 'default',
      strategy.interval,
    ].join(':');
    const group = groups.get(baseKey) ?? {
      scope: {
        connectorName,
        universe: strategy.universe,
        accountId: strategy.accountId,
        interval: strategy.interval,
        strategyNames: [],
      },
      strategyIdentities: [],
      strategies: [],
    };
    group.scope.strategyNames.push(strategy.strategyName);
    group.strategyIdentities.push(formatConfiguredStrategyIdentity(strategy));
    group.strategies.push(strategy);
    groups.set(baseKey, group);
  }

  return [...groups.entries()].map(([baseKey, group]) => {
    const selection = mergeConfiguredStrategySelections(group.strategies);
    return {
      key: [
        baseKey,
        deploymentIdentity,
        ...group.strategyIdentities.sort(),
      ].join(':'),
      scope: {
        ...group.scope,
        strategyNames: [...group.scope.strategyNames].sort(),
        ...(selection ? { selection } : {}),
      },
    };
  });
};
