import type { RuntimeDeployment } from '@tradejs/types';

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

  it('uses deployment strategies as optional overlays without filtering other active strategies', async () => {
    const mockLogger = { info: jest.fn(), warn: jest.fn() };
    jest.doMock('@tradejs/infra/logger', () => ({
      logger: mockLogger,
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
          key: 'users:root:strategies:DoubleTap:config',
          strategyName: 'DoubleTap',
          configId: 'config',
          strategyConfig: {
            ENABLE: true,
            INTERVAL: '5',
            AI_MODE: 'llm',
          },
        },
        {
          key: 'users:root:strategies:TrendShift:config',
          strategyName: 'TrendShift',
          configId: 'config',
          strategyConfig: {
            ENABLE: true,
            INTERVAL: '15',
            CUSTOM_THRESHOLD: 2,
          },
        },
      ]),
    }));

    const { loadRuntimeStrategies } = await import(
      '../lib/signals/runtimeStrategies'
    );

    const deployment: RuntimeDeployment = {
      id: 'crypto-forward',
      label: 'Crypto forward',
      connectorName: 'bybit',
      provider: 'bybit',
      accountId: 'bybit-prod',
      universe: 'crypto',
      interval: '15',
      enabled: true,
      strategies: [
        {
          strategyName: 'DoubleTap',
          policyProfileId: 'crypto',
          releaseCompositionId: 'DoubleTap_current',
          config: { AI_MODE: 'gate' },
        },
      ],
    };

    const strategies = await loadRuntimeStrategies({
      userName: 'root',
      projectRoot: '/project',
      deployment,
      connectorName: 'bybit',
      universe: 'crypto',
      accountId: 'bybit-main',
      interval: '15',
    });

    expect(strategies.map(({ strategyName }) => strategyName)).toEqual([
      'DoubleTap',
      'TrendShift',
    ]);
    expect(strategies[0]).toEqual(
      expect.objectContaining({
        strategyName: 'DoubleTap',
        releaseCompositionId: 'DoubleTap_current',
        strategyConfig: expect.objectContaining({
          AI_MODE: 'gate',
          INTERVAL: '15',
          UNIVERSE: 'crypto',
          ACCOUNT_ID: 'bybit-main',
          POLICY_PROFILE_ID: 'crypto',
        }),
      }),
    );
    expect(strategies[1]).toEqual(
      expect.objectContaining({
        strategyName: 'TrendShift',
        releaseCompositionId: undefined,
        strategyConfig: expect.objectContaining({
          CUSTOM_THRESHOLD: 2,
          INTERVAL: '15',
          UNIVERSE: 'crypto',
          ACCOUNT_ID: 'bybit-main',
        }),
      }),
    );
    expect(strategies[1]?.strategyConfig).not.toHaveProperty('AI_MODE');
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      'Skip deployment-disabled strategy config: %s',
      expect.any(String),
    );
  });

  it('lets deployment entries explicitly disable one active strategy', async () => {
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
          key: 'users:root:strategies:DoubleTap:config',
          strategyName: 'DoubleTap',
          configId: 'config',
          strategyConfig: { ENABLE: true, INTERVAL: '15' },
        },
        {
          key: 'users:root:strategies:TrendShift:config',
          strategyName: 'TrendShift',
          configId: 'config',
          strategyConfig: { ENABLE: true, INTERVAL: '15' },
        },
      ]),
    }));

    const { loadRuntimeStrategies } = await import(
      '../lib/signals/runtimeStrategies'
    );

    const strategies = await loadRuntimeStrategies({
      userName: 'root',
      projectRoot: '/project',
      deployment: {
        id: 'crypto-forward',
        label: 'Crypto forward',
        connectorName: 'bybit',
        provider: 'bybit',
        accountId: 'bybit-prod',
        universe: 'crypto',
        interval: '15',
        enabled: true,
        strategies: [{ strategyName: 'TrendShift', enabled: false }],
      },
      connectorName: 'bybit',
      universe: 'crypto',
      accountId: 'bybit-main',
      interval: '15',
    });

    expect(strategies.map(({ strategyName }) => strategyName)).toEqual([
      'DoubleTap',
    ]);
  });
});
