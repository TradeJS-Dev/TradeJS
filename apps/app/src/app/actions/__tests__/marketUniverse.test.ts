const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@tradejs/core/api', () => ({
  API: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { kline } from '../kline';
import { scan } from '../scanner';

describe('market-universe actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds an explicit universe scanner route with crypto fallback', async () => {
    mockGet.mockResolvedValue({ tickers: [{ value: 'BTCUSDT' }] });

    await expect(scan('coinbase')).resolves.toEqual([{ value: 'BTCUSDT' }]);
    expect(mockGet).toHaveBeenCalledWith('/api/scanner/coinbase/crypto');

    mockGet.mockResolvedValue({ tickers: [{ value: 'AAPLUSDT' }] });
    await scan('bybit', 'tradfi');
    expect(mockGet).toHaveBeenCalledWith('/api/scanner/bybit/tradfi');
  });

  it('builds an explicit universe kline route without leaking route fields into body', async () => {
    mockPost.mockResolvedValue({ data: [{ timestamp: 1 }] });

    await expect(
      kline({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
        start: 1,
        end: 2,
        cacheOnly: true,
      }),
    ).resolves.toEqual([{ timestamp: 1 }]);
    expect(mockPost).toHaveBeenCalledWith(
      '/api/kline/bybit/AAPLUSDT/15?universe=tradfi',
      { start: 1, end: 2, cacheOnly: true },
    );
  });

  it.each(['binance', 'coinbase'] as const)(
    'falls back to the crypto kline route for %s',
    async (provider) => {
      mockPost.mockResolvedValue({ data: [] });

      await kline({
        provider,
        symbol: 'BTCUSDT',
        interval: '15',
        start: 1,
        end: 2,
      });

      expect(mockPost).toHaveBeenCalledWith(
        `/api/kline/${provider}/BTCUSDT/15`,
        { start: 1, end: 2 },
      );
    },
  );
});
