const mockLoadRuntimeStrategyConfigs = jest.fn();
const mockListRuntimeDeployments = jest.fn();
const mockListTradingAccounts = jest.fn();
const mockResolveTradingAccount = jest.fn();
const mockGetAvailableStrategyNames = jest.fn();
const mockResolveConnectorAccountId = jest.fn();
const mockResolveConnectorCreatorByProvider = jest.fn();
const mockGetData = jest.fn();
const mockGetHashJsonValues = jest.fn();
const mockGetKeys = jest.fn();
const mockSyncRuntimeTrades = jest.fn();

jest.mock('@tradejs/infra/runtimeStrategyConfigs', () => ({
  loadRuntimeStrategyConfigs: (...args: unknown[]) =>
    mockLoadRuntimeStrategyConfigs(...args),
}));

jest.mock('@tradejs/infra/runtimeDeployments', () => ({
  listRuntimeDeployments: (...args: unknown[]) =>
    mockListRuntimeDeployments(...args),
}));

jest.mock('@tradejs/infra/tradingAccounts', () => ({
  listTradingAccounts: (...args: unknown[]) => mockListTradingAccounts(...args),
  resolveTradingAccount: (...args: unknown[]) =>
    mockResolveTradingAccount(...args),
}));

jest.mock('@tradejs/node/strategies', () => ({
  getAvailableStrategyNames: (...args: unknown[]) =>
    mockGetAvailableStrategyNames(...args),
}));

jest.mock('@tradejs/strategies', () => ({
  strategyEntries: [],
}));

jest.mock('#app/lib/connectorCreator', () => ({
  DEFAULT_CONNECTOR_PROVIDER: 'bybit',
  resolveConnectorAccountId: (...args: unknown[]) =>
    mockResolveConnectorAccountId(...args),
  resolveConnectorCreatorByProvider: (...args: unknown[]) =>
    mockResolveConnectorCreatorByProvider(...args),
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

jest.mock('#app/lib/runtimeTradeSync', () => ({
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
    mockLoadRuntimeStrategyConfigs.mockResolvedValue([
      {
        key: 'users:root:strategies:TrendLine:config',
        strategyName: 'TrendLine',
        configId: 'config',
        strategyConfig: { INTERVAL: '15', ENABLE: true },
      },
    ]);
    mockListRuntimeDeployments.mockResolvedValue([]);
    mockListTradingAccounts.mockResolvedValue([
      { id: 'crypto-main', label: 'Crypto main' },
    ]);
    mockResolveTradingAccount.mockResolvedValue({ id: 'crypto-main' });
    mockGetAvailableStrategyNames.mockResolvedValue([]);
    mockGetData.mockResolvedValue(null);
    mockGetHashJsonValues.mockResolvedValue([]);
    mockGetKeys.mockResolvedValue([]);
    mockSyncRuntimeTrades.mockImplementation(async ({ trades }) => trades);
    mockResolveConnectorAccountId.mockResolvedValue('crypto-main');
    mockResolveConnectorCreatorByProvider.mockResolvedValue(
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

    expect(mockResolveConnectorCreatorByProvider).toHaveBeenCalledWith(
      'bybit',
      '/project',
      'bybit',
    );
    expect(mockResolveConnectorAccountId).toHaveBeenCalledWith({
      userName: 'root',
      provider: 'bybit',
      universe: 'crypto',
    });
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
          configId: 'config',
          interval: '15',
          universe: 'crypto',
          accountId: 'crypto-main',
          accountLabel: 'Crypto main',
          connected: true,
          enabled: true,
          config: { INTERVAL: '15', ENABLE: true },
          symbols: [],
          orders: [],
        },
      ],
    });
  });

  it('fails before reading sources when the connector is unavailable', async () => {
    mockResolveConnectorCreatorByProvider.mockResolvedValue(null);

    await expect(
      loadRuntimeDashboard({ userName: 'root', provider: 'missing' }),
    ).rejects.toThrow('No connector available for provider "missing"');
    expect(mockLoadRuntimeStrategyConfigs).not.toHaveBeenCalled();
  });
});
