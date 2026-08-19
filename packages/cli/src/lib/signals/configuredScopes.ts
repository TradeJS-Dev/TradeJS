import type { ResolvedRuntimeStrategy } from '@tradejs/node/runtimeStrategies';
import type {
  Interval,
  MarketUniverse,
  RuntimeDeployment,
} from '@tradejs/types';

export interface ConfiguredSignalsScope {
  connectorName: string;
  universe: MarketUniverse;
  accountId?: string;
  interval: Interval;
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
    'strategyName' | 'version' | 'controlState'
  >,
) => `${strategy.strategyName}@v${strategy.version}[${strategy.controlState}]`;

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
      },
      strategyIdentities: [],
    };
    group.strategyIdentities.push(formatConfiguredStrategyIdentity(strategy));
    groups.set(baseKey, group);
  }

  return [...groups.entries()].map(([baseKey, group]) => ({
    key: [baseKey, deploymentIdentity, ...group.strategyIdentities.sort()].join(
      ':',
    ),
    scope: group.scope,
  }));
};
