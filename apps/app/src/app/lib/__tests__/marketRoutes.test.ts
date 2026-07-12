import {
  buildDashboardPath,
  buildKlinePath,
  parseDashboardPath,
} from '../marketRoutes';

const fallback = {
  provider: 'bybit' as const,
  universe: 'crypto' as const,
  symbol: 'BTCUSDT',
  interval: '15' as const,
};

describe('market routes', () => {
  it('uses an explicit static namespace for universe-aware routes', () => {
    expect(
      buildKlinePath({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    ).toBe('/api/kline/bybit/universe/tradfi/AAPLUSDT/15');
    expect(
      buildDashboardPath({
        provider: 'bybit',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
      }),
    ).toBe('/routes/dashboard/bybit/universe/tradfi/AAPLUSDT/15');
  });

  it('parses explicit universe-aware dashboard routes', () => {
    expect(
      parseDashboardPath(
        '/routes/dashboard/bybit/universe/tradfi/AAPLUSDT/60',
        fallback,
      ),
    ).toEqual({
      provider: 'bybit',
      universe: 'tradfi',
      symbol: 'AAPLUSDT',
      interval: '60',
    });
  });

  it('keeps legacy dashboard routes as crypto routes', () => {
    expect(
      parseDashboardPath('/routes/dashboard/bybit/ETHUSDT/5', fallback),
    ).toEqual({
      provider: 'bybit',
      universe: 'crypto',
      symbol: 'ETHUSDT',
      interval: '5',
    });
  });
});
