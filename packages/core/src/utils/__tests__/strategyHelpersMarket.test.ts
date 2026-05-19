import { getStrategyMarketSnapshot } from '../strategyHelpers/market';

describe('strategyHelpers/market getStrategyMarketSnapshot', () => {
  const candle = {
    open: 100,
    high: 120,
    low: 90,
    close: 110,
    volume: 1,
    timestamp: 1,
    turnover: 1,
    dt: '2026-01-01T00:00:00.000Z',
  };

  const baseParams = {
    env: 'BACKTEST',
    connector: {
      kline: jest.fn(),
    } as any,
    symbol: 'BTCUSDT',
    interval: '15' as any,
    cachedData: [candle],
    preloadStart: 0,
  };

  it('uses candle open price when backtestPriceMode=open', async () => {
    const snapshot = await getStrategyMarketSnapshot({
      ...baseParams,
      backtestPriceMode: 'open',
    });

    expect(snapshot.currentPrice).toBe(candle.open);
  });

  it('uses random price between low and high when backtestPriceMode=rand', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25);

    const snapshot = await getStrategyMarketSnapshot({
      ...baseParams,
      backtestPriceMode: 'rand',
    });

    expect(snapshot.currentPrice).toBe(97.5);
    expect(snapshot.currentPrice).toBeGreaterThanOrEqual(candle.low);
    expect(snapshot.currentPrice).toBeLessThanOrEqual(candle.high);

    randomSpy.mockRestore();
  });

  it('uses cached data in CRON mode without refetching connector kline', async () => {
    const connector = {
      kline: jest.fn(async () => [candle]),
    } as any;

    const snapshot = await getStrategyMarketSnapshot({
      ...baseParams,
      env: 'CRON',
      connector,
    });

    expect(snapshot.fullData).toEqual([candle]);
    expect(snapshot.currentPrice).toBe(candle.close);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('uses cached replay data in PARITY mode without refetching connector kline', async () => {
    const connector = {
      kline: jest.fn(async () => [candle]),
    } as any;

    const snapshot = await getStrategyMarketSnapshot({
      ...baseParams,
      env: 'PARITY',
      connector,
    });

    expect(snapshot.fullData).toEqual([candle]);
    expect(snapshot.currentPrice).toBe(candle.close);
    expect(connector.kline).not.toHaveBeenCalled();
  });
});
