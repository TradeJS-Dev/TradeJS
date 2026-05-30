export {};

describe('runtimeRedis', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('loads runtime trades from day buckets for the requested time window', async () => {
    const getKeys = jest.fn(async (_prefix: string) => []);
    const getHashJsonValues = jest.fn(async (key: string) => {
      if (key === 'users:root:runtime:trade-records:days:2026-05-02') {
        return [
          {
            orderId: 'ord-1',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            qty: 1,
            entryPrice: 100,
            entryTimestamp: Date.parse('2026-05-02T12:00:00.000Z'),
          },
        ];
      }

      if (key === 'users:root:runtime:trade-records:days:2026-05-03') {
        return [
          {
            orderId: 'ord-2',
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'SHORT',
            qty: 2,
            entryPrice: 50,
            entryTimestamp: Date.parse('2026-05-03T12:00:00.000Z'),
          },
        ];
      }

      return [];
    });

    jest.doMock('@tradejs/infra/redis', () => ({
      getData: jest.fn(),
      getHashJsonValues,
      getKeys,
      redisKeys: {
        strategies: (userName: string) => `users:${userName}:strategies`,
        runtimeTrades: (userName: string) =>
          `users:${userName}:runtime:trade-records:`,
        runtimeTradeBucket: (userName: string, dayKey: string) =>
          `users:${userName}:runtime:trade-records:days:${dayKey}`,
        strategyResults: (userName: string, strategy: string) =>
          `users:${userName}:strategies:${strategy}:results`,
      },
    }));

    const { loadRuntimeTrades } = await import('../lib/runtimeRedis');

    const trades = await loadRuntimeTrades('root', {
      startTime: Date.parse('2026-05-02T00:00:00.000Z'),
      endTime: Date.parse('2026-05-03T00:00:00.000Z'),
    });

    expect(trades).toEqual([
      expect.objectContaining({
        orderId: 'ord-1',
        symbol: 'BTCUSDT',
      }),
    ]);
    expect(getHashJsonValues).toHaveBeenCalledWith(
      'users:root:runtime:trade-records:days:2026-05-02',
    );
    expect(getHashJsonValues).toHaveBeenCalledWith(
      'users:root:runtime:trade-records:days:2026-05-03',
    );
    expect(getKeys).not.toHaveBeenCalled();
  });

  it('filters legacy runtime trade fallback by the requested time window', async () => {
    const getKeys = jest.fn(async (prefix: string) => {
      if (prefix === 'users:root:runtime:trade-records:') {
        return [
          'users:root:runtime:trade-records:ord-legacy',
          'users:root:runtime:trade-records:ord-old',
        ];
      }
      return [];
    });
    const getData = jest.fn(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:trade-records:ord-legacy') {
        return {
          orderId: 'ord-legacy',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: Date.parse('2026-05-02T12:00:00.000Z'),
        };
      }

      if (key === 'users:root:runtime:trade-records:ord-old') {
        return {
          orderId: 'ord-old',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          qty: 1,
          entryPrice: 50,
          entryTimestamp: Date.parse('2026-04-02T12:00:00.000Z'),
        };
      }

      return fallback;
    });
    const getHashJsonValues = jest.fn(async () => []);

    jest.doMock('@tradejs/infra/redis', () => ({
      getData,
      getHashJsonValues,
      getKeys,
      redisKeys: {
        strategies: (userName: string) => `users:${userName}:strategies`,
        runtimeTrades: (userName: string) =>
          `users:${userName}:runtime:trade-records:`,
        runtimeTradeBucket: (userName: string, dayKey: string) =>
          `users:${userName}:runtime:trade-records:days:${dayKey}`,
        strategyResults: (userName: string, strategy: string) =>
          `users:${userName}:strategies:${strategy}:results`,
      },
    }));

    const { loadRuntimeTrades } = await import('../lib/runtimeRedis');

    const trades = await loadRuntimeTrades('root', {
      startTime: Date.parse('2026-05-02T00:00:00.000Z'),
      endTime: Date.parse('2026-05-03T00:00:00.000Z'),
    });

    expect(trades).toEqual([
      expect.objectContaining({
        orderId: 'ord-legacy',
      }),
    ]);
    expect(getKeys).toHaveBeenCalledWith('users:root:runtime:trade-records:');
  });
});
