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

  it('getMarketData reuses one snapshot within the same BACKTEST bar and invalidates on the next bar', async () => {
    const data: any[] = [makeCandle(1_700_000_000_000, 100)];
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

    const first = await strategyApi.getMarketData();
    const second = await strategyApi.getMarketData();

    expect(second).toBe(first);

    data.push(makeCandle(1_700_000_060_000, 105));

    const third = await strategyApi.getMarketData();

    expect(third).not.toBe(second);
    expect(third.lastCandle.close).toBe(105);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('getMarketData ignores BACKTEST_PRICE_MODE and returns the closed candle close for signals', async () => {
    const data: any[] = [makeCandle(1_700_000_000_000, 100)];
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
      backtestPriceMode: 'open',
      isConfigFromBacktest: false,
    });

    const openMode = await strategyApi.getMarketData({
      backtestPriceMode: 'open',
    });
    const closeMode = await strategyApi.getMarketData({
      backtestPriceMode: 'close',
    });

    expect(openMode.currentPrice).toBe(100);
    expect(openMode.lastCandle.open).toBe(99);
    expect(closeMode).toBe(openMode);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('getCurrentPosition reuses one connector read within the same BACKTEST bar and invalidates on the next bar', async () => {
    const data: any[] = [makeCandle(1_700_000_000_000, 100)];
    let currentPosition: any = {
      symbol: 'TESTUSDT',
      qty: 1,
      price: 100,
      direction: 'LONG',
    };
    const connector = {
      kline: jest.fn(),
      getPosition: jest.fn(async () => currentPosition),
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

    const first = await strategyApi.getCurrentPosition();
    const second = await strategyApi.getCurrentPosition();

    expect(second).toBe(first);
    expect(connector.getPosition).toHaveBeenCalledTimes(1);

    data.push(makeCandle(1_700_000_060_000, 105));
    currentPosition = {
      symbol: 'TESTUSDT',
      qty: 2,
      price: 105,
      direction: 'LONG',
    };

    const third = await strategyApi.getCurrentPosition();

    expect(third).toBe(currentPosition);
    expect(connector.getPosition).toHaveBeenCalledTimes(2);
  });

  it('entry auto-builds timestamp/currentPrice/prices and code from market data + orderPlan', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
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

    const decision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [
          { rate: 0.5, price: 103 },
          { rate: 0.5, price: 110 },
        ],
      },
    });

    expect(decision.code).toBe('TREND_LINE_LONG_ENTRY');
    expect(decision.entryContext.timestamp).toBe(1_700_000_000_000);
    expect(decision.entryContext.prices).toEqual({
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    });
    expect(decision.signal?.prices.takeProfitPrice).toBe(110);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('entry uses provided code when passed', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
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

    const decision = await strategyApi.entry({
      code: 'CUSTOM_ENTRY_CODE',
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 110 }],
      },
    });

    expect(decision.code).toBe('CUSTOM_ENTRY_CODE');
  });

  it('entry always reads fresh market data snapshot', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
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

    const firstDecision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 110 }],
      },
    });

    data.push(makeCandle(1_700_000_060_000, 105));

    const secondDecision = await strategyApi.entry({
      direction: 'LONG',
      orderPlan: {
        qty: 1,
        stopLossPrice: 95,
        takeProfits: [{ rate: 1, price: 115 }],
      },
    });

    expect(firstDecision.entryContext.timestamp).toBe(1_700_000_000_000);
    expect(firstDecision.entryContext.prices.currentPrice).toBe(100);
    expect(secondDecision.entryContext.timestamp).toBe(1_700_000_060_000);
    expect(secondDecision.entryContext.prices.currentPrice).toBe(105);
    expect(connector.kline).not.toHaveBeenCalled();
  });

  it('exit auto-builds timestamp and price from market data', async () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
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

    const decision = await strategyApi.exit({
      direction: 'SHORT',
    });

    expect(decision).toEqual({
      kind: 'exit',
      code: 'TREND_LINE_SHORT_EXIT',
      closePlan: {
        direction: 'SHORT',
        price: 100,
        timestamp: 1_700_000_000_000,
      },
    });
  });

  it('protect builds deterministic protection decision', () => {
    const data = [makeCandle(1_700_000_000_000, 100)];
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

    expect(
      strategyApi.protect({
        protectPlan: {
          direction: 'LONG',
          stopLossPrice: 101,
        },
      }),
    ).toEqual({
      kind: 'protect',
      code: 'TREND_LINE_LONG_PROTECT',
      protectPlan: {
        direction: 'LONG',
        stopLossPrice: 101,
      },
    });
  });
});
