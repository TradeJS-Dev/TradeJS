import type { Connector, RuntimeTradeRecord } from '@tradejs/types';

describe('runtimeTradeSync', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('formats axios errors without leaking request headers', async () => {
    const { formatRuntimeTradeSyncError } = await import(
      '../lib/runtimeTradeSync'
    );

    const message = formatRuntimeTradeSyncError({
      isAxiosError: true,
      code: 'ECONNABORTED',
      message: 'timeout of 300000ms exceeded',
      config: {
        method: 'get',
        url: 'https://api.bybit.com/v5/position/list?category=linear&settleCoin=USDT',
        timeout: 300000,
        headers: {
          'X-BAPI-API-KEY': 'secret-key',
          'X-BAPI-SIGN': 'secret-signature',
        },
      },
    });

    expect(message).toBe(
      'timeout of 300000ms exceeded (axios, ECONNABORTED, GET https://api.bybit.com/v5/position/list?category=linear&settleCoin=USDT, timeout=300000ms)',
    );
    expect(message).not.toContain('secret-key');
    expect(message).not.toContain('secret-signature');
    expect(message).not.toContain('headers');
  });

  it('keeps active trades active when open position sync fails', async () => {
    const getData = jest.fn(async () => ({ orderId: 'ord-1' }));
    const setData = jest.fn(async () => null);
    const setHashJsonField = jest.fn(async () => null);
    const delKey = jest.fn(async () => true);

    jest.doMock('@tradejs/infra/redis', () => ({
      delKey,
      getData,
      redisKeys: {
        runtimeActiveTrade: (userName: string, symbol: string) =>
          `users:${userName}:runtime:active-trades:${symbol}`,
        runtimeTrade: (userName: string, orderId: string) =>
          `users:${userName}:runtime:trade-records:${orderId}`,
        runtimeTradeBucket: (userName: string, dayKey: string) =>
          `users:${userName}:runtime:trade-records:days:${dayKey}`,
      },
      setData,
      setHashJsonField,
    }));

    const { syncRuntimeTrades } = await import('../lib/runtimeTradeSync');
    const trade: RuntimeTradeRecord = {
      orderId: 'ord-1',
      strategy: 'TrendFollow',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: Date.parse('2026-06-01T00:00:00.000Z'),
      status: 'active',
      currentPrice: 101,
      currentPnl: 1,
    };
    const onError = jest.fn();
    const connector: Connector = {
      name: 'Test',
      getOpenPositionPnl: jest.fn(async () => {
        throw new Error('position timeout');
      }),
    } as unknown as Connector;

    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [trade],
      startTime: trade.entryTimestamp,
      endTime: trade.entryTimestamp + 60_000,
      openPositionCallbacks: {
        onError,
      },
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(synced).toEqual([
      expect.objectContaining({
        orderId: 'ord-1',
        status: 'active',
        lastSyncedAt: trade.entryTimestamp + 60_000,
      }),
    ]);
    expect(synced[0]).not.toHaveProperty('closedPnl');
    expect(synced[0]).not.toHaveProperty('exitTimestamp');
    expect(setData).not.toHaveBeenCalled();
    expect(setHashJsonField).not.toHaveBeenCalled();
    expect(delKey).not.toHaveBeenCalled();
  });
});
