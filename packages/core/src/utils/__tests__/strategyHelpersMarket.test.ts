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

  it('adds live top-of-book target venue from connector tickers', async () => {
    const connector = {
      kline: jest.fn(async () => [candle]),
      getTickers: jest.fn(async () => [
        {
          symbol: 'BTCUSDT',
          bid1Price: 99,
          ask1Price: 101,
          bid1Size: 3,
          ask1Size: 2,
        },
      ]),
    } as any;

    const snapshot = await getStrategyMarketSnapshot({
      ...baseParams,
      env: 'SIGNALS',
      connector,
    });

    expect(snapshot.targetVenue).toMatchObject({
      source: 'ticker_top_of_book',
      symbol: 'BTCUSDT',
      bid: 99,
      ask: 101,
      mid: 100,
      spreadBps: 200,
      topBidQty: 3,
      topAskQty: 2,
      stale: false,
    });
  });

  it('prefers connector top-of-book endpoint over full ticker list', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const connector = {
      kline: jest.fn(async () => [candle]),
      getTopOfBookTicker: jest.fn(async () => ({
        symbol: 'BTCUSDT',
        bidPrice: 99,
        askPrice: 101,
        bidQty: 3,
        askQty: 2,
        timestamp: 1_699_999_999_000,
      })),
      getTickers: jest.fn(async () => []),
    } as any;

    const snapshot = await getStrategyMarketSnapshot({
      ...baseParams,
      env: 'SIGNALS',
      connector,
    });

    expect(snapshot.targetVenue).toMatchObject({
      source: 'ticker_top_of_book',
      symbol: 'BTCUSDT',
      bid: 99,
      ask: 101,
      mid: 100,
      spreadBps: 200,
      topBidQty: 3,
      topAskQty: 2,
      snapshotTimestamp: 1_699_999_999_000,
      stale: false,
    });
    expect(connector.getTopOfBookTicker).toHaveBeenCalledWith('BTCUSDT');
    expect(connector.getTickers).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});
