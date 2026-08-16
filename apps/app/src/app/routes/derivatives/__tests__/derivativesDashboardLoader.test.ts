import { loadDerivativesDashboardData } from '../derivativesDashboardLoader';

describe('loadDerivativesDashboardData', () => {
  it('loads summary, detail and price data through one causal window', async () => {
    const get = jest.fn(async (url: string) =>
      url.includes('/summary') ? { hours: 24, items: [] } : { rows: [] },
    );
    const post = jest.fn(async () => ({ data: [] }));

    const result = await loadDerivativesDashboardData({
      hours: '24',
      selectedInterval: '1h',
      now: 1_000_000,
      client: { get, post },
    });

    expect(result.chartWindow).toEqual({
      startTimestamp: 1_000_000 - 24 * 60 * 60 * 1_000,
      endTimestamp: 1_000_000,
    });
    expect(get).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.detailsBySymbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});
