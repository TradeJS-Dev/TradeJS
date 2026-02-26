import { createStrategyAPI } from '../strategyHelpers/signalBuilders';

const makeCandle = (timestamp: number, price: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: price * 0.99,
  close: price,
  high: price * 1.01,
  low: price * 0.98,
  volume: 100 + price,
  turnover: price * 1000,
});

describe('createStrategyAPI', () => {
  it('getMarketData reads updated cachedData on each call in BACKTEST mode', async () => {
    const data: any[] = [];
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(),
    } as any;

    const strategyApi = createStrategyAPI({
      strategy: 'TrendLine' as any,
      symbol: 'TESTUSDT',
      interval: '15' as any,
      env: 'BACKTEST',
      connector,
      cachedData: data,
      preloadStart: 1,
      backtestPriceMode: 'close',
      isConfigFromBacktest: false,
    });

    data.push(makeCandle(1_700_000_000_000, 100));
    const first = await strategyApi.getMarketData();
    const firstLengthAtCall = first.fullData.length;

    data.push(makeCandle(1_700_000_060_000, 105));
    const second = await strategyApi.getMarketData();

    expect(firstLengthAtCall).toBe(1);
    expect(first.lastCandle.close).toBe(100);
    expect(first.fullData).toBe(second.fullData);
    expect(second.fullData).toHaveLength(2);
    expect(second.lastCandle.close).toBe(105);
    expect(second.currentPrice).toBe(105);
    expect(connector.kline).not.toHaveBeenCalled();
  });
});
