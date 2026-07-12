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
  it('keeps universe out of the route and uses a query only for TradFi', () => {
    expect(
      buildKlinePath({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    ).toBe('/api/kline/bybit/AAPLUSDT/15?universe=tradfi');
    expect(
      buildDashboardPath({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    ).toBe('/routes/dashboard/bybit/AAPLUSDT/15?universe=tradfi');
  });

  it('parses universe from the dashboard query', () => {
    expect(
      parseDashboardPath(
        '/routes/dashboard/bybit/AAPLUSDT/60',
        new URLSearchParams('universe=tradfi'),
        fallback,
      ),
    ).toEqual({
      provider: 'bybit',
      universe: 'tradfi',
      symbol: 'AAPLUSDT',
      interval: '60',
    });
  });

  it('falls back to crypto when the universe query is unknown', () => {
    expect(
      parseDashboardPath(
        '/routes/dashboard/coinbase/ETH-USD/5',
        new URLSearchParams('universe=unknown'),
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
      ).toBe(`/api/kline/${provider}/BTCUSDT/15`);
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
    ).toBe(
      '/routes/dashboard/bybit/AAPLUSDT/15?signalId=signal-1&universe=tradfi',
    );
  });
});
