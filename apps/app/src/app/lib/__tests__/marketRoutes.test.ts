import {
  buildDashboardPath,
  buildKlinePath,
  parseDashboardPath,
} from '../marketRoutes';

const fallback = {
  provider: 'bybit' as const,
  symbol: 'BTCUSDT',
  interval: '15' as const,
};

describe('market routes', () => {
  it('uses the universe value directly without a namespace segment', () => {
    expect(
      buildKlinePath({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    ).toBe('/api/kline/bybit/tradfi/AAPLUSDT/15');
    expect(
      buildDashboardPath({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    ).toBe('/routes/dashboard/bybit/tradfi/AAPLUSDT/15');
  });

  it('parses universe from the dashboard path', () => {
    expect(
      parseDashboardPath(
        '/routes/dashboard/bybit/tradfi/AAPLUSDT/60',
        fallback,
      ),
    ).toEqual({
      provider: 'bybit',
      universe: 'tradfi',
      symbol: 'AAPLUSDT',
      interval: '60',
    });
  });

  it('falls back to crypto when the universe segment is unknown', () => {
    expect(
      parseDashboardPath(
        '/routes/dashboard/coinbase/unknown/ETH-USD/5',
        fallback,
      ),
    ).toEqual({
      provider: 'coinbase',
      universe: 'crypto',
      symbol: 'ETH-USD',
      interval: '5',
    });
  });

  it.each(['binance', 'coinbase'])(
    'builds canonical crypto routes for %s',
    (provider) => {
      expect(
        buildKlinePath({
          provider,
          universe: 'crypto',
          symbol: 'BTCUSDT',
          interval: '15',
        }),
      ).toBe(`/api/kline/${provider}/crypto/BTCUSDT/15`);
    },
  );

  it('merges dashboard state into one query string', () => {
    expect(
      buildDashboardPath(
        {
          provider: 'bybit',
          universe: 'tradfi',
          symbol: 'AAPLUSDT',
          interval: '15',
        },
        new URLSearchParams('signalId=signal-1'),
      ),
    ).toBe('/routes/dashboard/bybit/tradfi/AAPLUSDT/15?signalId=signal-1');
  });
});
