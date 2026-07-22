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

  it('loads closed pnl in exchange-safe time chunks', async () => {
    const { EXCHANGE_HISTORY_MAX_RANGE_MS, loadClosedPnlRows } = await import(
      '../lib/runtimeTradeSync'
    );
    const startTime = Date.parse('2026-06-23T10:53:02.000Z');
    const endTime = startTime + 14 * 24 * 60 * 60 * 1000;
    const getClosedPnl = jest.fn(async ({ startTime: chunkStart }) => [
      {
        symbol: 'BTCUSDT',
        qty: 1,
        entryPrice: 100,
        exitPrice: 101,
        closedPnl: 1,
        closedAt: chunkStart + 1_000,
      },
    ]);
    const connector = {
      getClosedPnl,
    } as unknown as Connector;

    const rows = await loadClosedPnlRows({
      connector,
      startTime,
      endTime,
    });

    expect(getClosedPnl).toHaveBeenCalledTimes(2);
    expect(getClosedPnl).toHaveBeenNthCalledWith(1, {
      startTime,
      endTime: startTime + EXCHANGE_HISTORY_MAX_RANGE_MS,
      limit: 100,
    });
    expect(getClosedPnl).toHaveBeenNthCalledWith(2, {
      startTime: startTime + EXCHANGE_HISTORY_MAX_RANGE_MS + 1,
      endTime,
      limit: 100,
    });
    expect(rows.map((row) => row.closedAt)).toEqual([
      startTime + 1_000,
      startTime + EXCHANGE_HISTORY_MAX_RANGE_MS + 1 + 1_000,
    ]);
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

  it('keeps a missing exchange position pending until closed pnl is available', async () => {
    const getData = jest.fn(async () => ({ orderId: 'ord-pending' }));
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
    const entryTimestamp = Date.parse('2026-07-20T15:15:00.000Z');
    const startTime = Date.parse('2026-07-20T18:00:00.000Z');
    const endTime = Date.parse('2026-07-21T18:00:00.000Z');
    const trade: RuntimeTradeRecord = {
      orderId: 'ord-pending',
      strategy: 'LiquidityTails',
      symbol: 'MANTAUSDT',
      direction: 'SHORT',
      qty: 733.4,
      entryPrice: 0.06527,
      entryTimestamp,
      status: 'active',
      currentPrice: 0.06527,
      currentPnl: 0,
      openFee: 0.047869018,
      totalFee: 0.047869018,
    };
    const getClosedPnl = jest.fn(async () => []);
    const connector: Connector = {
      name: 'Test',
      getOpenPositionPnl: jest.fn(async () => []),
      getClosedPnl,
    } as unknown as Connector;

    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [trade],
      startTime,
      endTime,
    });

    expect(synced).toEqual([]);
    expect(getClosedPnl).toHaveBeenCalledWith({
      startTime: startTime - 24 * 60 * 60_000,
      endTime,
      limit: 100,
    });
    expect(setData).not.toHaveBeenCalled();
    expect(setHashJsonField).not.toHaveBeenCalled();
    expect(delKey).not.toHaveBeenCalled();
  });

  it('reconciles a persisted fallback close even when it carries the open fee', async () => {
    const getData = jest.fn(async () => null);
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

    const { isRuntimeTradeSyncFallbackClose, syncRuntimeTrades } = await import(
      '../lib/runtimeTradeSync'
    );
    const entryTimestamp = Date.parse('2026-07-20T15:15:00.000Z');
    const actualClosedAt = Date.parse('2026-07-20T17:40:00.000Z');
    const fallbackClosedAt = Date.parse('2026-07-20T18:00:00.619Z');
    const startTime = Date.parse('2026-07-20T18:00:00.401Z');
    const endTime = Date.parse('2026-07-21T18:00:00.401Z');
    const trade: RuntimeTradeRecord = {
      orderId: 'tjs-liquidityt-manta',
      strategy: 'LiquidityTails',
      symbol: 'MANTAUSDT',
      direction: 'SHORT',
      qty: 733.4,
      entryPrice: 0.06527,
      entryTimestamp,
      status: 'closed',
      currentPrice: 0.06527,
      currentPnl: 0,
      closedPnl: 0,
      exitPrice: null,
      actualExitPrice: null,
      exitTimestamp: fallbackClosedAt,
      lastSyncedAt: fallbackClosedAt,
      openFee: 0.047869018,
      closeFee: null,
      fundingFee: null,
      totalFee: 0.047869018,
    };
    const connector: Connector = {
      name: 'Test',
      getOpenPositionPnl: jest.fn(async () => []),
      getClosedPnl: jest.fn(async () => [
        {
          symbol: 'MANTAUSDT',
          direction: 'SHORT',
          qty: 733.4,
          entryPrice: 0.06527,
          exitPrice: 0.06305,
          closedPnl: 1.53,
          closedAt: actualClosedAt,
          orderLinkId: 'tjs-liquidityt-manta',
          openFee: 0.047869018,
          closeFee: 0.04624,
          totalFee: 0.094109018,
        },
      ]),
    } as unknown as Connector;

    expect(isRuntimeTradeSyncFallbackClose(trade)).toBe(true);

    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [trade],
      startTime,
      endTime,
    });

    expect(synced).toEqual([
      expect.objectContaining({
        orderId: 'tjs-liquidityt-manta',
        status: 'closed',
        currentPrice: 0.06305,
        currentPnl: 1.53,
        closedPnl: 1.53,
        exitPrice: 0.06305,
        actualExitPrice: 0.06305,
        exitTimestamp: actualClosedAt,
        closeFee: 0.04624,
        totalFee: 0.094109018,
        lastSyncedAt: endTime,
      }),
    ]);
    expect(setData).toHaveBeenCalledWith(
      'users:root:runtime:trade-records:tjs-liquidityt-manta',
      expect.objectContaining({
        closedPnl: 1.53,
        exitTimestamp: actualClosedAt,
      }),
      { expire: expect.any(Number) },
    );
    expect(setHashJsonField).toHaveBeenCalledWith(
      'users:root:runtime:trade-records:days:2026-07-20',
      'tjs-liquidityt-manta',
      expect.objectContaining({
        closedPnl: 1.53,
        exitTimestamp: actualClosedAt,
      }),
      { expire: expect.any(Number) },
    );
    expect(delKey).not.toHaveBeenCalled();
  });
});
