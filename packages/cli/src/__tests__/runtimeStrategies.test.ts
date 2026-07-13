export {};

describe('runtime strategy configuration safety', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('rejects two enabled configs of one strategy on the same effective account', async () => {
    jest.doMock('@tradejs/infra/logger', () => ({
      logger: { info: jest.fn(), warn: jest.fn() },
    }));
    jest.doMock('@tradejs/infra/redis', () => ({
      getData: jest.fn(async () => ({})),
      redisKeys: {
        strategyResults: (userName: string, strategyName: string) =>
          `users:${userName}:strategies:${strategyName}:results`,
      },
    }));
    jest.doMock('@tradejs/infra/tradingAccounts', () => ({
      resolveTradingAccount: jest.fn(async () => ({ id: 'bybit-main' })),
    }));
    jest.doMock('@tradejs/node/strategies', () => ({
      getStrategyCreator: jest.fn(async () => jest.fn()),
    }));
    jest.doMock('../lib/runtimeRedis', () => ({
      isRuntimeStrategyEnabled: jest.fn(() => true),
      loadRuntimeStrategyConfigs: jest.fn(async () => [
        {
          key: 'users:root:strategies:TrendLine:config',
          strategyName: 'TrendLine',
          configId: 'config',
          strategyConfig: { INTERVAL: '15', UNIVERSE: 'crypto' },
        },
        {
          key: 'users:root:strategies:TrendLine:fast',
          strategyName: 'TrendLine',
          configId: 'fast',
          strategyConfig: { INTERVAL: '5', UNIVERSE: 'crypto' },
        },
      ]),
    }));

    const { loadRuntimeStrategies } = await import(
      '../lib/signals/runtimeStrategies'
    );

    await expect(
      loadRuntimeStrategies({ userName: 'root', projectRoot: '/project' }),
    ).rejects.toThrow(
      'configs "config" and "fast" resolve to account "bybit-main"',
    );
  });
});
