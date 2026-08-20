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
            trade.status === 'active' &&
            trade.deploymentId === deploymentId &&
            strategyNameSet.has(trade.strategy) &&
            (trade.universe ?? 'crypto') === universe &&
            (!trade.accountId || trade.accountId === accountId) &&
            (!trade.interval || String(trade.interval) === String(interval)),
        )
        .map(({ symbol }) => symbol),
    ),
  ].sort();
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
    }
  >();

  for (const strategy of strategies) {
    const selectionIdentity = JSON.stringify({
      tickers: sorted(strategy.selection?.tickers),
    });
    const baseKey = [
      connectorName,
      strategy.universe,
      strategy.accountId ?? 'default',
      strategy.interval,
      selectionIdentity,
    ].join(':');
    const group = groups.get(baseKey) ?? {
      scope: {
        connectorName,
        universe: strategy.universe,
        accountId: strategy.accountId,
        interval: strategy.interval,
        strategyNames: [],
        ...(strategy.selection
          ? {
              selection: { tickers: [...strategy.selection.tickers] },
            }
          : {}),
      },
      strategyIdentities: [],
    };
    group.scope.strategyNames.push(strategy.strategyName);
    group.strategyIdentities.push(formatConfiguredStrategyIdentity(strategy));
    groups.set(baseKey, group);
  }

  return [...groups.entries()].map(([baseKey, group]) => ({
    key: [baseKey, deploymentIdentity, ...group.strategyIdentities.sort()].join(
      ':',
    ),
    scope: {
      ...group.scope,
      strategyNames: [...group.scope.strategyNames].sort(),
    },
  }));
};
