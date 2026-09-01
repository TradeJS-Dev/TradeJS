const mockListRuntimeDeployments = jest.fn();
const mockLoadResolvedRuntimeStrategies = jest.fn();
const mockListTradingAccounts = jest.fn();
const mockResolveTradingAccount = jest.fn();
const mockGetAvailableStrategyNames = jest.fn();
const mockGetConnectorCreatorByProvider = jest.fn();
const mockGetData = jest.fn();
const mockGetHashJsonValues = jest.fn();
const mockGetKeys = jest.fn();
const mockSyncRuntimeTrades = jest.fn();

jest.mock('../runtimeStrategies', () => ({
  listRuntimeDeployments: (...args: unknown[]) =>
    mockListRuntimeDeployments(...args),
  loadResolvedRuntimeStrategies: (...args: unknown[]) =>
    mockLoadResolvedRuntimeStrategies(...args),
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  listTradingAccounts: (...args: unknown[]) => mockListTradingAccounts(...args),
  resolveTradingAccount: (...args: unknown[]) =>
    mockResolveTradingAccount(...args),
}));

jest.mock('../strategies', () => ({
  getAvailableStrategyNames: (...args: unknown[]) =>
    mockGetAvailableStrategyNames(...args),
}));

jest.mock('../connectorsRegistry', () => ({
  getConnectorCreatorByProvider: (...args: unknown[]) =>
    mockGetConnectorCreatorByProvider(...args),
}));

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getHashJsonValues: (...args: unknown[]) => mockGetHashJsonValues(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  redisKeys: {
    runtimeTradeBucket: (userName: string, dayKey: string) =>
      `runtime-trades:${userName}:${dayKey}`,
    runtimeTradeBuckets: (userName: string) =>
      `runtime-trades:${userName}:days:`,
    runtimeTrades: (userName: string) => `runtime-trades:${userName}`,
    runtimeActiveTrades: (userName: string) =>
      `runtime-active-trades:${userName}`,
    runtimeLineageScopeBucket: (userName: string, dayKey: string) =>
      `runtime-lineage:${userName}:${dayKey}`,
  },
}));

jest.mock('../runtimeTradeSync', () => ({
  ...jest.requireActual('../runtimeTradeSync'),
  syncRuntimeTrades: (...args: unknown[]) => mockSyncRuntimeTrades(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    warn: (...args: unknown[]) => args,
  },
}));

import { loadRuntimeDashboard } from '../runtimeDashboard';
describe('runtime dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListRuntimeDeployments.mockResolvedValue([
      {
        id: 'trendline-forward',
        deploymentCompositionId: 'dc1:2222222222222222',
        label: 'TrendLine forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        enabled: true,
        strategies: [
          {
            strategyName: 'TrendLine',
            strategyRevision: 'sr1:2222222222222222',
            enabled: true,
            controlState: 'active',
          },
        ],
      },
    ]);
    mockLoadResolvedRuntimeStrategies.mockResolvedValue([
      {
        strategyName: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        deploymentCompositionId: 'dc1:2222222222222222',
        enabled: true,
        controlState: 'active',
        interval: '15',
        universe: 'crypto',
        accountId: 'crypto-main',
        strategyConfig: {
          INTERVAL: '15',
          UNIVERSE: 'crypto',
          POLICY_PROFILE_ID: 'crypto',
        },
      },
    ]);
    mockListTradingAccounts.mockResolvedValue([
      { id: 'crypto-main', label: 'Crypto main' },
    ]);
    mockResolveTradingAccount.mockResolvedValue({ id: 'crypto-main' });
    mockGetAvailableStrategyNames.mockResolvedValue([]);
    mockGetData.mockResolvedValue(null);
    mockGetHashJsonValues.mockResolvedValue([]);
    mockGetKeys.mockResolvedValue([]);
    mockSyncRuntimeTrades.mockImplementation(async ({ trades }) => trades);
    mockGetConnectorCreatorByProvider.mockResolvedValue(
      jest.fn(async ({ accountId, deploymentId }) => ({
        universe: 'crypto',
        accountId,
        deploymentId,
      })),
    );
  });

  it('builds the complete dashboard read model through one interface', async () => {
    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: ' bybit ',
      hours: 2,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(mockGetConnectorCreatorByProvider).toHaveBeenCalledWith(
      'bybit',
      '/project',
    );
    expect(response).toMatchObject({
      provider: 'bybit',
      hours: 6,
      generatedAt: 1_700_000_000_000,
      dataSources: {
        localTrades: 0,
        exchangeFallbackTrades: 0,
        exchangeErrors: [],
      },
      strategies: [
        {
          strategyName: 'TrendLine',
          configId: 'sr1:2222222222222222',
          strategyRevision: 'sr1:2222222222222222',
          interval: '15',
          universe: 'crypto',
          accountId: 'crypto-main',
          accountLabel: 'Crypto main',
          connected: true,
          enabled: true,
          config: {
            INTERVAL: '15',
            UNIVERSE: 'crypto',
            POLICY_PROFILE_ID: 'crypto',
          },
          symbols: [],
          orders: [],
        },
      ],
    });
  });

  it('binds the connector before reconciling deployment-scoped trades', async () => {
    mockGetHashJsonValues.mockResolvedValue([
      {
        orderId: 'production-order',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        deploymentId: 'trendline-forward',
        accountId: 'crypto-main',
        universe: 'crypto',
        symbol: 'BTCUSDT',
        interval: '15',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 60_000,
        status: 'active',
      },
    ]);

    await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(mockSyncRuntimeTrades).toHaveBeenCalledWith(
      expect.objectContaining({
        connector: expect.objectContaining({
          accountId: 'crypto-main',
          deploymentId: 'trendline-forward',
        }),
        trades: [expect.objectContaining({ orderId: 'production-order' })],
      }),
    );
  });

  it('surfaces an invalid Git-owned runtime declaration', async () => {
    mockLoadResolvedRuntimeStrategies.mockRejectedValue(
      new Error('Invalid runtime strategy declaration: production/TrendLine'),
    );

    await expect(
      loadRuntimeDashboard({
        userName: 'root',
        provider: 'bybit',
        hours: 6,
        now: 1_700_000_000_000,
        projectRoot: '/project',
      }),
    ).rejects.toThrow('Invalid runtime strategy declaration');
  });

  it('fails before reading sources when the connector is unavailable', async () => {
    mockGetConnectorCreatorByProvider.mockResolvedValue(null);

    await expect(
      loadRuntimeDashboard({ userName: 'root', provider: 'missing' }),
    ).rejects.toThrow('No connector available for provider "missing"');
    expect(mockListRuntimeDeployments).not.toHaveBeenCalled();
  });

  it('does not expose local assessment evidence in the runtime response', async () => {
    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(response.strategies[0]).not.toHaveProperty('evidenceTimeline');
    expect(JSON.stringify(response)).not.toContain('/private/evidence');
    expect(
      mockGetHashJsonValues.mock.calls.some(([key]) =>
        String(key).startsWith('runtime-lineage:'),
      ),
    ).toBe(false);
  });

  it('groups runtime trades only by strategy and interval across revisions', async () => {
    mockGetHashJsonValues.mockResolvedValue([
      {
        orderId: 'old-revision',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:1111111111111111',
        symbol: 'BTCUSDT',
        interval: '15',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 120_000,
        exitPrice: 101,
        exitTimestamp: 1_700_000_000_000 - 90_000,
        closedPnl: 1,
        status: 'closed',
      },
      {
        orderId: 'current-revision',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        deploymentId: 'another-deployment',
        policyProfileId: 'another-policy',
        universe: 'tradfi',
        accountId: 'another-account',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 60_000,
        exitPrice: 102,
        exitTimestamp: 1_700_000_000_000 - 30_000,
        closedPnl: 2,
        status: 'closed',
      },
      {
        orderId: 'other-timeframe',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        symbol: 'SOLUSDT',
        interval: '5',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 45_000,
        status: 'active',
      },
      {
        orderId: 'other-strategy',
        strategy: 'DoubleTap',
        strategyRevision: 'sr1:2222222222222222',
        symbol: 'XRPUSDT',
        interval: '15',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 30_000,
        status: 'active',
      },
    ]);

    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(response.strategies[0]).toMatchObject({
      strategyName: 'TrendLine',
      summary: { totalTrades: 2, closedTrades: 2 },
      symbols: ['ETHUSDT', 'BTCUSDT'],
      revisionChanges: [
        {
          timestamp: 1_700_000_000_000 - 60_000,
          strategyRevision: 'sr1:2222222222222222',
        },
      ],
    });
  });

  it('keeps active orders in the card header and orders list but excludes them from the chart and footer stats', async () => {
    const now = 1_700_000_000_000;
    const startTime = now - 6 * 60 * 60 * 1000;
    const exitTimestamp = now - 90_000;
    mockGetHashJsonValues.mockResolvedValue([
      {
        orderId: 'closed-order',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        symbol: 'BTCUSDT',
        interval: '15',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: now - 120_000,
        exitPrice: 112,
        exitTimestamp,
        closedPnl: 12,
        status: 'closed',
      },
      {
        orderId: 'active-order',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'SHORT',
        qty: 1,
        entryPrice: 200,
        entryTimestamp: now - 60_000,
        currentPnl: -3,
        status: 'active',
      },
    ]);

    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now,
      projectRoot: '/project',
    });

    const strategy = response.strategies[0];
    expect(strategy).toMatchObject({
      summary: {
        totalTrades: 2,
        activeTrades: 1,
        closedTrades: 1,
      },
      stat: {
        orders: 1,
        netProfit: 12,
        amount: 112,
      },
      orderLog: [
        [startTime, 100],
        [exitTimestamp, 112],
        [now, 112],
      ],
    });
    expect(strategy?.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: 'closed-order', status: 'closed' }),
        expect.objectContaining({ orderId: 'active-order', status: 'active' }),
      ]),
    );
  });

  it('merges legacy runtime records with daily buckets', async () => {
    mockGetHashJsonValues.mockResolvedValue([
      {
        orderId: 'bucket-other-timeframe',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        symbol: 'BTCUSDT',
        interval: '5',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 60_000,
        status: 'active',
      },
    ]);
    mockGetKeys.mockResolvedValue(['runtime-trades:root:legacy']);
    mockGetData.mockResolvedValue({
      orderId: 'legacy-matching-timeframe',
      strategy: 'TrendLine',
      strategyRevision: 'sr1:1111111111111111',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_700_000_000_000 - 30_000,
      status: 'active',
    });

    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(response.strategies[0]?.summary.totalTrades).toBe(1);
    expect(response.strategies[0]?.symbols).toEqual(['ETHUSDT']);
  });

  it('deduplicates legacy and bucket copies using the freshest trade record', async () => {
    mockGetHashJsonValues.mockResolvedValue([
      {
        orderId: 'duplicated-order',
        strategy: 'TrendLine',
        strategyRevision: 'sr1:2222222222222222',
        symbol: 'BTCUSDT',
        interval: '15',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: 1_700_000_000_000 - 60_000,
        exitPrice: 103,
        exitTimestamp: 1_700_000_000_000 - 15_000,
        closedPnl: 3,
        status: 'closed',
        lastSyncedAt: 200,
      },
    ]);
    mockGetKeys.mockResolvedValue(['runtime-trades:root:duplicated-order']);
    mockGetData.mockResolvedValue({
      orderId: 'duplicated-order',
      strategy: 'TrendLine',
      strategyRevision: 'sr1:2222222222222222',
      symbol: 'BTCUSDT',
      interval: '15',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: 1_700_000_000_000 - 60_000,
      currentPnl: 1,
      status: 'active',
      lastSyncedAt: 100,
    });

    const response = await loadRuntimeDashboard({
      userName: 'root',
      provider: 'bybit',
      hours: 6,
      now: 1_700_000_000_000,
      projectRoot: '/project',
    });

    expect(response.strategies[0]?.summary).toMatchObject({
      totalTrades: 1,
      activeTrades: 0,
      closedTrades: 1,
      closedPnl: 3,
    });
  });
});
