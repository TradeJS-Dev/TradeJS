export {};

describe('runtimeRedis', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('loads multiple named configs for the same strategy and ignores reserved keys', async () => {
    const getKeys = jest.fn(async () => [
      'users:root:strategies:TrendLine:config',
      'users:root:strategies:TrendLine:conservative',
      'users:root:strategies:TrendLine:results',
      'users:root:strategies:charts:runtime',
    ]);
    const getData = jest.fn(async (key: string) => ({ key }));
    jest.doMock('@tradejs/infra/redis', () => ({
      getData,
      getHashJsonValues: jest.fn(),
      getKeys,
      redisKeys: {
        strategies: (userName: string) => `users:${userName}:strategies`,
      },
    }));

    const { loadRuntimeStrategyConfigs } = await import('../lib/runtimeRedis');

    await expect(loadRuntimeStrategyConfigs('root')).resolves.toEqual([
      expect.objectContaining({
        strategyName: 'TrendLine',
        configId: 'config',
      }),
      expect.objectContaining({
        strategyName: 'TrendLine',
        configId: 'conservative',
      }),
    ]);
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
        runtimeTradeBuckets: (userName: string) =>
          `users:${userName}:runtime:trade-records:days:`,
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
        runtimeTradeBuckets: (userName: string) =>
          `users:${userName}:runtime:trade-records:days:`,
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

  it('loads trades closed in the requested window independently of entry day', async () => {
    const exitTimestamp = Date.parse('2026-05-03T12:00:00.000Z');
    const getHashJsonValues = jest.fn(async () => [
      {
        orderId: 'ord-closed',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entryPrice: 100,
        entryTimestamp: Date.parse('2026-04-20T12:00:00.000Z'),
        status: 'closed',
        exitTimestamp,
        closedPnl: 5,
      },
    ]);
    jest.doMock('@tradejs/infra/redis', () => ({
      getData: jest.fn(),
      getHashJsonValues,
      getKeys: jest.fn(),
      redisKeys: {
        runtimeClosedTradeBucket: (userName: string, dayKey: string) =>
          `users:${userName}:runtime:closed-trade-records:days:${dayKey}`,
      },
    }));

    const { loadRuntimeClosedTrades } = await import('../lib/runtimeRedis');
    const trades = await loadRuntimeClosedTrades('root', {
      startTime: Date.parse('2026-05-03T00:00:00.000Z'),
      endTime: Date.parse('2026-05-04T00:00:00.000Z'),
    });

    expect(trades).toEqual([
      expect.objectContaining({ orderId: 'ord-closed', exitTimestamp }),
    ]);
  });

  it('loads scoped active runtime trade order ids', async () => {
    const activePrefix = 'users:root:runtime:active-trades:';
    const getKeys = jest.fn(async (prefix: string) =>
      prefix === activePrefix
        ? [
            `${activePrefix}bybit-default:BTCUSDT`,
            `${activePrefix}crypto-live:ETHUSDT`,
            `${activePrefix}stale`,
          ]
        : [],
    );
    const getData = jest.fn(async (key: string, fallback: unknown) => {
      if (key.endsWith('bybit-default:BTCUSDT')) {
        return { orderId: 'ord-account' };
      }
      if (key.endsWith('crypto-live:ETHUSDT')) {
        return { orderId: 'ord-deployment' };
      }
      if (key.endsWith('stale')) {
        return { orderId: '' };
      }

      return fallback;
    });

    jest.doMock('@tradejs/infra/redis', () => ({
      getData,
      getHashJsonValues: jest.fn(),
      getKeys,
      redisKeys: {
        runtimeActiveTrades: (userName: string) =>
          `users:${userName}:runtime:active-trades:`,
      },
    }));

    const { loadRuntimeActiveTradeOrderIds } = await import(
      '../lib/runtimeRedis'
    );

    await expect(loadRuntimeActiveTradeOrderIds('root')).resolves.toEqual(
      new Set(['ord-account', 'ord-deployment']),
    );
    expect(getKeys).toHaveBeenCalledWith(activePrefix);
  });
});
