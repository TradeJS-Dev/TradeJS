import type { ResolvedRuntimeStrategy } from '@tradejs/node/runtimeStrategies';
import type { RuntimeDeployment } from '@tradejs/types';
import {
  buildConfiguredSignalsScopes,
  formatConfiguredStrategyIdentity,
  getConfiguredScopeActiveSymbols,
} from '../lib/signals/configuredScopes';

const deployment: RuntimeDeployment = {
  id: 'production',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      version: 2,
      enabled: true,
      controlState: 'entries_paused',
    },
  ],
  tickers: ['ETHUSDT', 'BTCUSDT'],
};

const strategy = {
  strategyName: 'DoubleTap',
  version: 2,
  enabled: true,
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
          version: 4,
        },
      ],
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.scope).toEqual({
      connectorName: 'bybit',
      universe: 'crypto',
      accountId: 'bybit-default',
      interval: '15',
      strategyNames: ['DoubleTap', 'Grid'],
    });
  });

  it('creates separate sessions for strategy ticker selections', () => {
    const scopes = buildConfiguredSignalsScopes({
      connectorName: 'bybit',
      deployment,
      strategies: [
        { ...strategy, selection: { tickers: ['BTCUSDT'] } },
        {
          ...strategy,
          strategyName: 'Grid',
          selection: { tickers: ['ETHUSDT'] },
        },
      ],
    });

    expect(scopes).toHaveLength(2);
    expect(scopes.map(({ scope }) => scope)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          strategyNames: ['DoubleTap'],
          selection: { tickers: ['BTCUSDT'] },
        }),
        expect.objectContaining({
          strategyNames: ['Grid'],
          selection: { tickers: ['ETHUSDT'] },
        }),
      ]),
    );
  });

  it('retains only active symbols owned by the configured strategy scope', () => {
    const activeTrade = {
      orderId: 'ord-active',
      strategy: 'DoubleTap',
      deploymentId: deployment.id,
      accountId: deployment.accountId,
      universe: 'crypto',
      interval: '15',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1,
      status: 'active',
    } as const;

    expect(
      getConfiguredScopeActiveSymbols({
        trades: [
          activeTrade,
          { ...activeTrade, orderId: 'ord-duplicate' },
          { ...activeTrade, orderId: 'ord-other', strategy: 'Grid' },
          {
            ...activeTrade,
            orderId: 'ord-deployment',
            deploymentId: 'other-deployment',
          },
          { ...activeTrade, orderId: 'ord-closed', status: 'closed' },
        ],
        deploymentId: deployment.id,
        strategyNames: ['DoubleTap'],
        universe: 'crypto',
        accountId: deployment.accountId,
        interval: '15',
      }),
    ).toEqual(['SOLUSDT']);
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
          strategies: [{ ...deployment.strategies[0]!, version: 3 }],
        },
        strategy: { ...strategy, version: 3 },
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
