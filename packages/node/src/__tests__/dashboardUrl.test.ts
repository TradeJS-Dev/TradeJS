import { buildDashboardUrl } from '../dashboardUrl';

describe('dashboard URL', () => {
  it('uses crypto fallback without a universe query', () => {
    expect(
      buildDashboardUrl({
        baseUrl: 'https://app.tradejs.dev',
        symbol: 'BTCUSDT',
        interval: '15',
        searchParams: { signalId: 'signal-1' },
      }),
    ).toBe(
      'https://app.tradejs.dev/routes/dashboard/bybit/BTCUSDT/15?signalId=signal-1',
    );
  });

  it('keeps TradFi in a query parameter', () => {
    expect(
      buildDashboardUrl({
        baseUrl: 'https://app.tradejs.dev',
        universe: 'tradfi',
        symbol: 'AAPLUSDT',
        interval: '15',
        searchParams: { signalId: 'signal-2' },
      }),
    ).toBe(
      'https://app.tradejs.dev/routes/dashboard/bybit/AAPLUSDT/15?signalId=signal-2&universe=tradfi',
    );
  });
});
