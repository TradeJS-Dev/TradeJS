import type { ResolvedRuntimeStrategy } from '@tradejs/node/runtimeStrategies';
import type { RuntimeDeployment } from '@tradejs/types';
import {
  buildConfiguredSignalsScopes,
  createConfiguredStrategySymbolMatcher,
  formatConfiguredStrategyIdentity,
  getConfiguredScopeActiveSymbols,
} from '../lib/signals/configuredScopes';

const deployment: RuntimeDeployment = {
  id: 'production',
  deploymentCompositionId: 'dc1:1111111111111111',
  label: 'Production',
  connectorName: 'bybit',
  provider: 'bybit',
  accountId: 'bybit-default',
  enabled: true,
  strategies: [
    {
      strategyName: 'DoubleTap',
      strategyRevision: 'sr1:2222222222222222',
      enabled: true,
      controlState: 'entries_paused',
    },
  ],
  tickers: ['ETHUSDT', 'BTCUSDT'],
};

const strategy = {
  strategyName: 'DoubleTap',
  strategyRevision: 'sr1:2222222222222222',
  deploymentCompositionId: 'dc1:1111111111111111',
  enabled: true,
  controlState: 'entries_paused',
  interval: '15',
  universe: 'crypto',
  accountId: 'bybit-default',
} as ResolvedRuntimeStrategy;

describe('configured signals scopes', () => {
  it('logs the immutable release and mutable control state together', () => {
    expect(formatConfiguredStrategyIdentity(strategy)).toBe(
      'DoubleTap@sr1:2222222222222222[entries_paused]',
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
          strategyRevision: 'sr1:4444444444444444',
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

  it('merges strategy ticker selections into one transport session', () => {
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

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.scope).toEqual({
      connectorName: 'bybit',
      universe: 'crypto',
      accountId: 'bybit-default',
      interval: '15',
      strategyNames: ['DoubleTap', 'Grid'],
      selection: { tickers: ['BTCUSDT', 'ETHUSDT'] },
    });
  });

  it('uses the full transport universe when any strategy is unbounded', () => {
    const scopes = buildConfiguredSignalsScopes({
      connectorName: 'bybit',
      deployment,
      strategies: [
        strategy,
        {
          ...strategy,
          strategyName: 'Grid',
          selection: { tickers: ['ETHUSDT'] },
        },
      ],
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.scope).not.toHaveProperty('selection');
  });

  it('normalizes and deduplicates the merged transport selection', () => {
    const scopes = buildConfiguredSignalsScopes({
      connectorName: 'bybit',
      deployment,
      strategies: [
        {
          ...strategy,
          selection: { tickers: ['ethusdt', 'BTCUSDT'] },
        },
        {
          ...strategy,
          strategyName: 'Grid',
          selection: { tickers: ['ETHUSDT', 'solusdt'] },
        },
      ],
    });

    expect(scopes).toHaveLength(1);
    expect(scopes[0]?.scope.selection).toEqual({
      tickers: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    });
  });

  it('keeps different transport scopes in separate sessions', () => {
    const scopes = buildConfiguredSignalsScopes({
      connectorName: 'bybit',
      deployment,
      strategies: [
        strategy,
        {
          ...strategy,
          strategyName: 'HourlyGrid',
          interval: '60',
        },
        {
          ...strategy,
          strategyName: 'SecondaryGrid',
          accountId: 'bybit-secondary',
        },
      ],
    });

    expect(scopes).toHaveLength(3);
    expect(
      scopes.map(({ scope }) => ({
        accountId: scope.accountId,
        interval: scope.interval,
        strategies: scope.strategyNames,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          accountId: 'bybit-default',
          interval: '15',
          strategies: ['DoubleTap'],
        },
        {
          accountId: 'bybit-default',
          interval: '60',
          strategies: ['HourlyGrid'],
        },
        {
          accountId: 'bybit-secondary',
          interval: '15',
          strategies: ['SecondaryGrid'],
        },
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

  it('filters each strategy by selection but retains its active positions', () => {
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
    const matches = createConfiguredStrategySymbolMatcher({
      trades: [
        activeTrade,
        {
          ...activeTrade,
          orderId: 'ord-other-deployment',
          symbol: 'XRPUSDT',
          deploymentId: 'other-deployment',
        },
      ],
      deploymentId: deployment.id,
      universe: 'crypto',
      accountId: deployment.accountId,
      interval: '15',
    });
    const selectedStrategy = {
      ...strategy,
      selection: { tickers: ['BTCUSDT'] },
    };

    expect(matches(selectedStrategy, 'btcusdt')).toBe(true);
    expect(matches(selectedStrategy, 'SOLUSDT')).toBe(true);
    expect(matches(selectedStrategy, 'XRPUSDT')).toBe(false);
    expect(matches(strategy, 'XRPUSDT')).toBe(true);
    expect(
      matches({ ...strategy, selection: { tickers: ['btc'] } }, 'BTCUSDT'),
    ).toBe(true);
  });

  it('retains an active symbol only for its exact strategy and runtime scope', () => {
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
    const selectedStrategy = {
      ...strategy,
      selection: { tickers: ['BTCUSDT'] },
    };
    const otherStrategy = {
      ...selectedStrategy,
      strategyName: 'Grid',
    };

    const matches = createConfiguredStrategySymbolMatcher({
      trades: [activeTrade],
      deploymentId: deployment.id,
      universe: 'crypto',
      accountId: deployment.accountId,
      interval: '15',
    });
    const wrongAccount = createConfiguredStrategySymbolMatcher({
      trades: [activeTrade],
      deploymentId: deployment.id,
      universe: 'crypto',
      accountId: 'bybit-secondary',
      interval: '15',
    });
    const wrongInterval = createConfiguredStrategySymbolMatcher({
      trades: [activeTrade],
      deploymentId: deployment.id,
      universe: 'crypto',
      accountId: deployment.accountId,
      interval: '60',
    });

    expect(matches(selectedStrategy, 'SOLUSDT')).toBe(true);
    expect(matches(otherStrategy, 'SOLUSDT')).toBe(false);
    expect(wrongAccount(selectedStrategy, 'SOLUSDT')).toBe(false);
    expect(wrongInterval(selectedStrategy, 'SOLUSDT')).toBe(false);
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
          strategies: [
            {
              ...deployment.strategies[0]!,
              strategyRevision: 'sr1:3333333333333333',
            },
          ],
        },
        strategy: {
          ...strategy,
          strategyRevision: 'sr1:3333333333333333',
        },
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
