import { loadDerivativesDashboardData } from '../derivativesDashboardLoader';

describe('loadDerivativesDashboardData', () => {
  it('loads summary, detail and price data through one causal window', async () => {
    const getMock = jest.fn(async (url: string) =>
      url.includes('/summary') ? { hours: 24, items: [] } : { rows: [] },
    );
    const postMock = jest.fn(async (_url: string, _body: object) => ({
      data: [],
    }));
    const client = {
      get: <T>(url: string) => getMock(url) as Promise<T>,
      post: <T>(url: string, body: object) => postMock(url, body) as Promise<T>,
    };

    const result = await loadDerivativesDashboardData({
      hours: '24',
      selectedInterval: '1h',
      now: 1_000_000,
      client,
    });

    expect(result.chartWindow).toEqual({
      startTimestamp: 1_000_000 - 24 * 60 * 60 * 1_000,
      endTimestamp: 1_000_000,
    });
    expect(getMock).toHaveBeenCalledTimes(3);
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.detailsBySymbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});
