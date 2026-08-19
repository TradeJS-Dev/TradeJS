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
    runtimeTrades: (userName: string) => `runtime-trades:${userName}`,
    runtimeActiveTrades: (userName: string) =>
      `runtime-active-trades:${userName}`,
    runtimeLineageScopeBucket: (userName: string, dayKey: string) =>
      `runtime-lineage:${userName}:${dayKey}`,
  },
}));

jest.mock('../runtimeTradeSync', () => ({
  isRuntimeTradeInConnectorScope: jest.fn(() => true),
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
        label: 'TrendLine forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'crypto-main',
        enabled: true,
        strategies: [
          {
            strategyName: 'TrendLine',
            version: 2,
            enabled: true,
            controlState: 'active',
          },
        ],
      },
    ]);
    mockLoadResolvedRuntimeStrategies.mockResolvedValue([
      {
        strategyName: 'TrendLine',
        version: 2,
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
      jest.fn(async () => ({
        universe: 'crypto',
        accountId: 'crypto-main',
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
          configId: 'v2',
          version: 2,
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
});
