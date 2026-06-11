const mockGetKeys = jest.fn();
const mockGetData = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  getData: (...args: unknown[]) => mockGetData(...args),
  getHashJsonValues: jest.fn(),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  redisKeys: {
    strategies: (userName: string) => `users:${userName}:strategies`,
    runtimeTrades: (userName: string) =>
      `users:${userName}:runtime:trade-records:`,
    runtimeTradeBuckets: (userName: string) =>
      `users:${userName}:runtime:trade-records:days:`,
    runtimeTradeBucket: (userName: string, dayKey: string) =>
      `users:${userName}:runtime:trade-records:days:${dayKey}`,
    strategyResults: (userName: string, strategy: string) =>
      `users:${userName}:strategies:${strategy}:results`,
  },
}));

describe('runtime strategy backtest config loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips runtime strategy configs with ENABLE=false', async () => {
    mockGetKeys.mockResolvedValue([
      'users:root:strategies:TrendLine:config',
      'users:root:strategies:VolumeDivergence:config',
    ]);
    mockGetData.mockImplementation(async (key: string) => {
      if (key === 'users:root:strategies:TrendLine:config') {
        return { INTERVAL: '15', ENABLE: true };
      }
      if (key === 'users:root:strategies:VolumeDivergence:config') {
        return { INTERVAL: '15', ENABLE: false };
      }
      return null;
    });

    const { loadRuntimeStrategyBacktestConfigs } = await import(
      '../lib/runtimeStrategyBacktest'
    );

    await expect(loadRuntimeStrategyBacktestConfigs('root')).resolves.toEqual([
      expect.objectContaining({
        strategyName: 'TrendLine',
        strategyConfig: expect.objectContaining({ ENABLE: true }),
      }),
    ]);
  });
});
