import { fetchWithRetry } from '@tradejs/infra/http';
import {
  mapBinanceKline,
  mapCoinbaseKline,
  spotKlineProviders,
} from '../spotKlineProviders';

jest.mock('@tradejs/infra/http', () => ({
  fetchWithRetry: jest.fn(),
}));

const mockedFetchWithRetry = fetchWithRetry as jest.MockedFunction<
  typeof fetchWithRetry
>;

const makeResponse = ({
  ok = true,
  status = 200,
  payload = [],
  text = 'error',
}: {
  ok?: boolean;
  status?: number;
  payload?: unknown;
  text?: string;
} = {}) =>
  ({
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(text),
  }) as any;

describe('spotKlineProviders mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BINANCE_BASE_URL;
    delete process.env.COINBASE_BASE_URL;
  });

  test('mapBinanceKline maps, filters invalid rows and sorts by timestamp', () => {
    const rows = mapBinanceKline([
      [1700000001000, '100', '110', '90', '105', '12', 0, '123', 0, '7', '72'],
      'invalid-row',
      [1700000000000, '90', '100', '80', '95', '10'],
      [1700000002000, 'oops', '120', '100', '110', '9'],
    ] as unknown[]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.timestamp)).toEqual([
      1700000000000, 1700000001000,
    ]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        open: 90,
        high: 100,
        low: 80,
        close: 95,
        volume: 10,
        turnover: 0,
      }),
    );
    expect(rows[1]?.turnover).toBe(123);
    expect(rows[1]?.takerBuyBaseVolume).toBe(7);
    expect(rows[1]?.takerSellBaseVolume).toBe(5);
    expect(rows[1]?.takerBuyQuoteVolume).toBe(72);
    expect(rows[1]?.takerSellQuoteVolume).toBe(51);
  });

  test('mapCoinbaseKline maps, filters invalid rows and sorts by timestamp', () => {
    const rows = mapCoinbaseKline([
      [1700000001, 90, 110, 100, 105, 12],
      null,
      [1700000000, 80, 100, 90, 95, 10],
      [1700000002, 'bad', 120, 110, 115, 5],
    ] as unknown[]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.timestamp)).toEqual([
      1700000000000, 1700000001000,
    ]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        open: 90,
        high: 100,
        low: 80,
        close: 95,
        volume: 10,
        turnover: 0,
      }),
    );
  });

  test('binance kline uses configured base url and 1h token', async () => {
    process.env.BINANCE_BASE_URL = ' https://binance.local ';
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({
        payload: [[1700000000000, '100', '110', '90', '105', '12', 0, '123']],
      }),
    );

    const result = await spotKlineProviders.binance.kline({
      symbol: 'BTCUSDT',
      interval: '1h',
      start: 1700000000000,
      end: 1700000900000,
    });

    expect(result).toHaveLength(1);
    expect(mockedFetchWithRetry).toHaveBeenCalledTimes(1);

    const [urlString, options] = mockedFetchWithRetry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const url = new URL(urlString);
    expect(url.origin).toBe('https://binance.local');
    expect(url.pathname).toBe('/api/v3/klines');
    expect(url.searchParams.get('symbol')).toBe('BTCUSDT');
    expect(url.searchParams.get('interval')).toBe('1h');
    expect(url.searchParams.get('startTime')).toBe('1700000000000');
    expect(url.searchParams.get('endTime')).toBe('1700000900000');
    expect(url.searchParams.get('limit')).toBe('1000');
    expect(options).toEqual({
      headers: { 'User-Agent': 'tradejs/market-data-ingest' },
    });
  });

  test('binance kline maps non-1h interval to 15m token', async () => {
    mockedFetchWithRetry.mockResolvedValue(makeResponse({ payload: [] }));

    await spotKlineProviders.binance.kline({
      symbol: 'ETHUSDT',
      interval: '15m',
      start: 1,
      end: 2,
    });

    const [urlString] = mockedFetchWithRetry.mock.calls[0] as [string];
    const url = new URL(urlString);
    expect(url.searchParams.get('interval')).toBe('15m');
  });

  test('binance kline throws when response is not ok', async () => {
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({ ok: false, status: 500, text: 'internal' }),
    );

    await expect(
      spotKlineProviders.binance.kline({
        symbol: 'BTCUSDT',
        interval: '15m',
        start: 1,
        end: 2,
      }),
    ).rejects.toThrow('Binance kline 500: internal');
  });

  test('binance kline returns empty array for non-array payload', async () => {
    mockedFetchWithRetry.mockResolvedValue(makeResponse({ payload: {} }));

    const result = await spotKlineProviders.binance.kline({
      symbol: 'BTCUSDT',
      interval: '15m',
      start: 1,
      end: 2,
    });

    expect(result).toEqual([]);
  });

  test('coinbase kline uses configured base url and 15m granularity', async () => {
    process.env.COINBASE_BASE_URL = 'https://coinbase.local';
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({ payload: [[1700000000, 90, 110, 100, 105, 12]] }),
    );

    const result = await spotKlineProviders.coinbase.kline({
      symbol: 'BTC-USD',
      interval: '15m',
      start: 1700000000000,
      end: 1700000900000,
    });

    expect(result).toHaveLength(1);
    const [urlString, options] = mockedFetchWithRetry.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const url = new URL(urlString);
    expect(url.origin).toBe('https://coinbase.local');
    expect(url.pathname).toBe('/products/BTC-USD/candles');
    expect(url.searchParams.get('granularity')).toBe('900');
    expect(url.searchParams.get('start')).toBe(
      new Date(1700000000000).toISOString(),
    );
    expect(url.searchParams.get('end')).toBe(
      new Date(1700000900000).toISOString(),
    );
    expect(options).toEqual({
      headers: {
        'User-Agent': 'tradejs/market-data-ingest',
        Accept: 'application/json',
      },
    });
  });

  test('coinbase kline returns empty array on 404', async () => {
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({ ok: false, status: 404 }),
    );

    const result = await spotKlineProviders.coinbase.kline({
      symbol: 'BTC-USD',
      interval: '1h',
      start: 1,
      end: 2,
    });

    expect(result).toEqual([]);
  });

  test('coinbase kline throws when response is not ok and not 404', async () => {
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({ ok: false, status: 429, text: 'rate limited' }),
    );

    await expect(
      spotKlineProviders.coinbase.kline({
        symbol: 'BTC-USD',
        interval: '1h',
        start: 1,
        end: 2,
      }),
    ).rejects.toThrow('Coinbase kline 429: rate limited');
  });

  test('coinbase kline returns empty array for non-array payload', async () => {
    mockedFetchWithRetry.mockResolvedValue(
      makeResponse({ payload: { candles: [] } }),
    );

    const result = await spotKlineProviders.coinbase.kline({
      symbol: 'BTC-USD',
      interval: '1h',
      start: 1,
      end: 2,
    });

    expect(result).toEqual([]);
  });
});
