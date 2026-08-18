import type { ResolvedRuntimeStrategy } from '@tradejs/node/runtimeStrategies';
import type { RuntimeDeployment } from '@tradejs/types';
import {
  buildConfiguredSignalsScopes,
  formatConfiguredStrategyIdentity,
} from '../lib/signals/configuredScopes';

const deployment: RuntimeDeployment = {
  id: 'doubletap-forward',
  label: 'DoubleTap forward',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      releaseVersion: 2,
      controlState: 'entries_paused',
    },
  ],
  tickers: ['ETHUSDT', 'BTCUSDT'],
};

const strategy = {
  strategyName: 'DoubleTap',
  releaseVersion: 2,
  controlState: 'entries_paused',
  interval: '15',
  universe: 'crypto',
  accountId: 'bybit-default',
} as ResolvedRuntimeStrategy;

describe('configured signals scopes', () => {
  it('logs the immutable release and mutable control state together', () => {
    expect(formatConfiguredStrategyIdentity(strategy)).toBe(
      'DoubleTap@v2[entries_paused]',
    );
  });

  it('groups strategies sharing one runtime scope into one session', () => {
    const scopes = buildConfiguredSignalsScopes({
      connectorName: 'bybit',
      deployment,
      strategies: [
        strategy,
        {
          ...strategy,
          strategyName: 'Grid',
          releaseVersion: 4,
        },
      ],
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.scope).toEqual({
      connectorName: 'bybit',
      universe: 'crypto',
      accountId: 'bybit-default',
      interval: '15',
    });
  });

  it('changes the session identity after runtime binding changes', () => {
    const before = buildConfiguredSignalsScopes({
      connectorName: 'bybit',
      deployment,
      strategies: [strategy],
    });
    const changes: Array<{
      deployment: RuntimeDeployment;
      strategy: ResolvedRuntimeStrategy;
    }> = [
      {
        deployment: {
          ...deployment,
          strategies: [{ ...deployment.strategies[0]!, releaseVersion: 3 }],
        },
        strategy: { ...strategy, releaseVersion: 3 },
      },
      {
        deployment: {
          ...deployment,
          strategies: [
            { ...deployment.strategies[0]!, controlState: 'active' },
          ],
        },
        strategy: { ...strategy, controlState: 'active' },
      },
      {
        deployment: { ...deployment, tickers: ['SOLUSDT'] },
        strategy,
      },
    ];

    for (const change of changes) {
      const after = buildConfiguredSignalsScopes({
        connectorName: 'bybit',
        deployment: change.deployment,
        strategies: [change.strategy],
      });
      expect(after[0]?.key).not.toBe(before[0]?.key);
    }
  });
});
