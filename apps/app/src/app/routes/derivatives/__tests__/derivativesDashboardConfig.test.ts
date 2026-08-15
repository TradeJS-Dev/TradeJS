import { buildDerivativesDashboardRequest } from '../derivativesDashboardConfig';

describe('buildDerivativesDashboardRequest', () => {
  it('builds one causal window for summary, derivatives and price requests', () => {
    const request = buildDerivativesDashboardRequest({
      hours: '24',
      selectedInterval: '1h',
      now: 1_800_000_000_000,
    });

    expect(request.chartWindow).toEqual({
      startTimestamp: 1_799_913_600_000,
      endTimestamp: 1_800_000_000_000,
    });
    expect(request.summaryPath).toContain('symbols=BTCUSDT,ETHUSDT');
    expect(request.details).toEqual([
      expect.objectContaining({
        symbol: 'BTCUSDT',
        derivativesPath:
          '/api/derivatives/BTCUSDT/1h?from=1799913600000&to=1800000000000',
        pricePath: expect.stringContaining(
          '/api/kline/bybit/crypto/BTCUSDT/60',
        ),
        priceBody: {
          start: 1_799_913_600_000,
          end: 1_800_000_000_000,
        },
      }),
      expect.objectContaining({ symbol: 'ETHUSDT' }),
    ]);
  });
});
