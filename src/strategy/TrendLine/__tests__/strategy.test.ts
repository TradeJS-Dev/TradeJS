import { TrendlineStrategyCreator } from '../strategy';
import { createIndicators } from '../indicators';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { filterByVeryVolatility } from '../filters';

jest.mock('@utils/trendLineEngine', () => ({
  createTrendlineEngine: jest.fn(),
}));

jest.mock('@utils/redis', () => ({
  getData: jest.fn(async () => ({})),
  redisKeys: {
    strategyResults: jest.fn(() => 'strategy:results:TrendLine'),
  },
}));

jest.mock('@utils/mlGrpc', () => ({
  fetchMlThreshold: jest.fn(async () => null),
}));

jest.mock('@utils/correlation', () => ({
  calculateCoinBtcCorrelation: jest.fn(() => ({ correlation: 0 })),
}));

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
}));

jest.mock('../indicators', () => {
  const actual = jest.requireActual('../indicators');
  return {
    ...actual,
    createIndicators: jest.fn(),
  };
});

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

describe('TrendlineStrategyCreator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores 10 indicator values and exposes them in signal', async () => {
    (createTrendlineEngine as jest.Mock).mockImplementation(
      (_data, options) => {
        const line = {
          id: 'line-1',
          mode: options.mode ?? 'lows',
          distance: 1,
          touches: [{ timestamp: 1, value: 1 }],
          points: [{ timestamp: 1, value: 1 }],
        };
        return {
          next: jest.fn(() => [line]),
        };
      },
    );

    let counter = 0;
    (createIndicators as jest.Mock).mockImplementation(() => () => {
      counter += 1;
      const value = counter;
      return {
        maFast: value,
        maMedium: value,
        maSlow: value,
        atr: value,
        bbUpper: value,
        bbMiddle: value,
        bbLower: value,
        obv: value,
        macd: value,
        macdSignal: value,
        macdHistogram: value,
        price24hPcnt: value,
        price1hPcnt: value,
        prevPrice24hPcnt: value,
        prevPrice1hPcnt: value,
        highPrice1h: value,
        lowPrice1h: value,
        volume1h: value,
        highPrice24h: value,
        lowPrice24h: value,
        volume24h: value,
        prevHighPrice1h: value,
        prevLowPrice1h: value,
        prevVolume1h: value,
        prevHighPrice24h: value,
        prevLowPrice24h: value,
        prevVolume24h: value,
      };
    });

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: false,
        MAX_LOSS_VALUE: 10,
        MAX_CORRELATION: 1,
        TRENDLINE: {},
        HIGHS: {
          enable: false,
          direction: 'LONG',
          TP: 2,
          SL: 1,
          minRiskRatio: 0,
        },
        LOWS: {
          enable: true,
          direction: 'LONG',
          TP: 2,
          SL: 1,
          minRiskRatio: 0,
        },
      },
      symbol: 'TESTUSDT',
      data: cachedData,
      btcData: btcCachedData,
      connector,
    });

    let result: any = null;
    const start = 1_700_000_000_000;
    for (let i = 0; i < 10; i += 1) {
      const candle = makeCandle(start + i * 900_000, 100 + i);
      const btcCandle = makeCandle(start + i * 900_000, 20000 + i);
      result = await strategy(candle, btcCandle);
    }

    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
    expect(result.indicators.maFast).toHaveLength(10);
    expect(result.indicators.price24hPcnt).toHaveLength(10);
    expect(result.indicators.volume24h).toHaveLength(10);
  });

  it('returns VERY_VOLATILITY when filter fails', async () => {
    (filterByVeryVolatility as jest.Mock).mockReturnValue(false);
    (createTrendlineEngine as jest.Mock).mockImplementation(
      (_data, options) => {
        const line = {
          id: 'line-1',
          mode: options.mode ?? 'lows',
          distance: 1,
          touches: [{ timestamp: 1, value: 1 }],
          points: [{ timestamp: 1, value: 1 }],
        };
        return {
          next: jest.fn(() => [line]),
        };
      },
    );

    (createIndicators as jest.Mock).mockImplementation(() => () => ({
      maFast: 1,
      maMedium: 1,
      maSlow: 1,
      atr: 1,
      bbUpper: 1,
      bbMiddle: 1,
      bbLower: 1,
      obv: 1,
      macd: 1,
      macdSignal: 1,
      macdHistogram: 1,
      price24hPcnt: 1,
      price1hPcnt: 1,
      prevPrice24hPcnt: 1,
      prevPrice1hPcnt: 1,
      highPrice1h: 1,
      lowPrice1h: 1,
      volume1h: 1,
      highPrice24h: 1,
      lowPrice24h: 1,
      volume24h: 1,
      prevHighPrice1h: 1,
      prevLowPrice1h: 1,
      prevVolume1h: 1,
      prevHighPrice24h: 1,
      prevLowPrice24h: 1,
      prevVolume24h: 1,
    }));

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: false,
        MAX_LOSS_VALUE: 10,
        MAX_CORRELATION: 1,
        TRENDLINE: {},
        HIGHS: {
          enable: false,
          direction: 'LONG',
          TP: 2,
          SL: 1,
          minRiskRatio: 0,
        },
        LOWS: {
          enable: true,
          direction: 'LONG',
          TP: 2,
          SL: 1,
          minRiskRatio: 0,
        },
      },
      symbol: 'TESTUSDT',
      data: cachedData,
      btcData: btcCachedData,
      connector,
    });

    const candle = makeCandle(1_700_000_000_000, 100);
    const btcCandle = makeCandle(1_700_000_000_000, 20000);
    const result = await strategy(candle, btcCandle);

    expect(result).toBe('VERY_VOLATILITY');
  });
});
