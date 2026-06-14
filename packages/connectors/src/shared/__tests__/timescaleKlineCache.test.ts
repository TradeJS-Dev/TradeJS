import { createTimescaleCachedKline } from '../timescaleKlineCache';
import { delay } from '@tradejs/core/async';
import {
  getCandlesRange,
  getDataEdges,
  toRows,
  upsertCandles,
} from '@tradejs/infra/timescale';

jest.mock('@tradejs/core/async', () => ({
  delay: jest.fn(async () => undefined),
}));

jest.mock('@tradejs/infra/timescale', () => ({
  getCandlesRange: jest.fn(),
  getDataEdges: jest.fn(),
  upsertCandles: jest.fn(),
  toRows: jest.fn((provider, symbol, interval, data) => ({
    provider,
    symbol,
    interval,
    data,
  })),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

const mockedGetCandlesRange = getCandlesRange as jest.MockedFunction<
  typeof getCandlesRange
>;
const mockedGetDataEdges = getDataEdges as jest.MockedFunction<
  typeof getDataEdges
>;
const mockedToRows = toRows as jest.MockedFunction<typeof toRows>;
const mockedUpsertCandles = upsertCandles as jest.MockedFunction<
  typeof upsertCandles
>;
const mockedDelay = delay as jest.MockedFunction<typeof delay>;

describe('createTimescaleCachedKline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.TIMESCALE_KLINE_RETRIES;
    delete process.env.TIMESCALE_KLINE_RETRY_DELAY_MS;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads cache using provider-aware Timescale queries', async () => {
    mockedGetDataEdges.mockResolvedValue({ min: undefined, max: 2_000 });
    mockedGetCandlesRange.mockResolvedValue([
      {
        ts: new Date(1_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
      } as any,
    ]);

    const request = jest.fn();
    const kline = createTimescaleCachedKline({
      provider: 'binance',
      request,
      intervalToMinutes: () => 15,
    });

    const result = await kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: 2_000,
      cacheOnly: true,
    });

    expect(result).toEqual([
      expect.objectContaining({
        timestamp: 1_000,
        close: 1.5,
      }),
    ]);
    expect(mockedGetDataEdges).toHaveBeenCalledWith('binance', 'BTCUSDT', 15);
    expect(mockedGetCandlesRange).toHaveBeenCalledWith(
      'binance',
      'BTCUSDT',
      15,
      0,
      2_000,
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('writes older/newer/tail candles with provider-aware rows', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(600_000);
    mockedGetDataEdges.mockResolvedValue({ min: 300_000, max: 300_000 });
    mockedGetCandlesRange.mockResolvedValue([
      {
        ts: new Date(300_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.2,
        volume: 10,
        turnover: 20,
      } as any,
    ]);
    mockedUpsertCandles.mockResolvedValue(undefined as any);

    const request = jest
      .fn()
      .mockResolvedValueOnce([
        {
          timestamp: 240_000,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.1,
          volume: 10,
          turnover: 20,
          dt: new Date(240_000).toISOString(),
        },
      ])
      .mockResolvedValueOnce([
        {
          timestamp: 540_000,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.3,
          volume: 10,
          turnover: 20,
          dt: new Date(540_000).toISOString(),
        },
      ])
      .mockResolvedValueOnce([
        {
          timestamp: 600_000,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.4,
          volume: 10,
          turnover: 20,
          dt: new Date(600_000).toISOString(),
        },
      ]);

    const kline = createTimescaleCachedKline({
      provider: 'coinbase',
      request,
      intervalToMinutes: () => 1,
    });

    await kline({
      symbol: 'BTCUSDT',
      interval: '1',
      start: 60_000,
      end: 600_000,
      silent: true,
    });

    expect(mockedToRows).toHaveBeenNthCalledWith(
      1,
      'coinbase',
      'BTCUSDT',
      1,
      expect.any(Array),
    );
    expect(mockedToRows).toHaveBeenNthCalledWith(
      2,
      'coinbase',
      'BTCUSDT',
      1,
      expect.any(Array),
    );
    expect(mockedToRows).toHaveBeenNthCalledWith(
      3,
      'coinbase',
      'BTCUSDT',
      1,
      expect.any(Array),
    );
    expect(mockedUpsertCandles).toHaveBeenCalledTimes(3);
    expect(mockedGetCandlesRange).toHaveBeenCalledWith(
      'coinbase',
      'BTCUSDT',
      1,
      60_000,
      600_000,
    );
  });

  it('retries a transient Timescale failure before using exchange fallback', async () => {
    mockedGetDataEdges
      .mockRejectedValueOnce(
        new Error('timeout exceeded when trying to connect'),
      )
      .mockResolvedValueOnce({ min: 60_000, max: 120_000 });
    mockedGetCandlesRange.mockResolvedValue([
      {
        ts: new Date(60_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
      } as any,
    ]);

    const request = jest.fn();

    const kline = createTimescaleCachedKline({
      provider: 'binance',
      request,
      intervalToMinutes: () => 1,
    });

    await expect(
      kline({
        symbol: 'BTCUSDT',
        interval: '1',
        start: 60_000,
        end: 120_000,
        silent: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        timestamp: 60_000,
        close: 1.5,
      }),
    ]);

    expect(mockedGetDataEdges).toHaveBeenCalledTimes(2);
    expect(mockedDelay).toHaveBeenCalledWith(1_000);
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back to exchange request when Timescale retries are exhausted', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));

    const request = jest.fn().mockResolvedValue([
      {
        timestamp: 1_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
        dt: new Date(1_000).toISOString(),
      },
    ]);

    process.env.TIMESCALE_KLINE_RETRY_DELAY_MS = '0';

    const kline = createTimescaleCachedKline({
      provider: 'binance',
      request,
      intervalToMinutes: () => 15,
    });

    await expect(
      kline({
        symbol: 'BTCUSDT',
        interval: '15',
        end: 2_000,
        silent: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        timestamp: 1_000,
        close: 1.5,
      }),
    ]);

    expect(mockedGetDataEdges).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledTimes(1);
    expect(mockedGetCandlesRange).not.toHaveBeenCalled();
    expect(mockedUpsertCandles).not.toHaveBeenCalled();
  });
});
