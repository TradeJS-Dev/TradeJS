import { TrendlineStrategyCreator } from '../strategy';
import { createIndicators } from '@utils/indicators';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import { calculateCoinBtcCorrelation } from '@utils/correlation';
import { filterByVeryVolatility } from '../filters';
import { logger } from '@utils/logger';
import { fetchMlThreshold } from '@utils/mlGrpc';

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

jest.mock('@utils/indicators', () => {
  const actual = jest.requireActual('@utils/indicators');
  return {
    ...actual,
    createIndicators: jest.fn(),
  };
});

jest.mock('@utils/logger', () => ({
  logger: {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

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
    (filterByVeryVolatility as jest.Mock).mockReturnValue(true);
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
    (createIndicators as jest.Mock).mockImplementation(() => {
      const indicatorHistory: Record<string, number[]> = {};
      const pushIndicator = (key: string, value: number) => {
        if (!indicatorHistory[key]) {
          indicatorHistory[key] = [];
        }
        indicatorHistory[key].push(value);
        if (indicatorHistory[key].length > 10) {
          indicatorHistory[key].splice(0, indicatorHistory[key].length - 10);
        }
      };
      const next = () => {
        counter += 1;
        const value = counter;
        const indicators = {
          maFast: value,
          maMedium: value,
          maSlow: value,
          atr: value,
          atrPct: value,
          bbUpper: value,
          bbMiddle: value,
          bbLower: value,
          obv: value,
          smaObv: value,
          macd: value,
          macdSignal: value,
          macdHistogram: value,
          price24hPcnt: value,
          price1hPcnt: value,
          highPrice1h: value,
          lowPrice1h: value,
          volume1h: value,
          highPrice24h: value,
          lowPrice24h: value,
          volume24h: value,
        };

        Object.entries(indicators).forEach(([key, val]) => {
          pushIndicator(key, val);
        });

        return indicators;
      };

      return {
        next,
        result: () => indicatorHistory,
      };
    });

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
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
    expect(result.indicators.atrPct).toHaveLength(10);
    expect(result.indicators.smaObv).toHaveLength(10);
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

    (createIndicators as jest.Mock).mockImplementation(() => {
      const indicatorHistory: Record<string, number[]> = {};
      const pushIndicator = (key: string, value: number) => {
        if (!indicatorHistory[key]) {
          indicatorHistory[key] = [];
        }
        indicatorHistory[key].push(value);
        if (indicatorHistory[key].length > 10) {
          indicatorHistory[key].splice(0, indicatorHistory[key].length - 10);
        }
      };

      const next = () => {
        const indicators = {
          maFast: 1,
          maMedium: 1,
          maSlow: 1,
          atr: 1,
          atrPct: 1,
          bbUpper: 1,
          bbMiddle: 1,
          bbLower: 1,
          obv: 1,
          smaObv: 1,
          macd: 1,
          macdSignal: 1,
          macdHistogram: 1,
          price24hPcnt: 1,
          price1hPcnt: 1,
          highPrice1h: 1,
          lowPrice1h: 1,
          volume1h: 1,
          highPrice24h: 1,
          lowPrice24h: 1,
          volume24h: 1,
        };

        Object.entries(indicators).forEach(([key, val]) => {
          pushIndicator(key, val);
        });

        return indicators;
      };

      return {
        next,
        result: () => indicatorHistory,
      };
    });

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
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

  it('passes ML signal via signal.indicators without raw candles config fields', async () => {
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
    (createIndicators as jest.Mock).mockImplementation(() => ({
      next: jest.fn(() => ({ maFast: 1 })),
      result: () => ({
        maFast: [1],
        candles15m: [makeCandle(1, 100)],
        btcCandles15m: [makeCandle(1, 20000)],
      }),
    }));

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };
    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
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

    const candle = makeCandle(2, 101);
    const btcCandle = makeCandle(2, 20001);
    await strategy(candle, btcCandle);

    expect(fetchMlThreshold).toHaveBeenCalled();
    const [signalArg, configArg] = (fetchMlThreshold as jest.Mock).mock
      .calls[0] as any[];
    expect(configArg.candles).toBeUndefined();
    expect(configArg.btcCandles).toBeUndefined();
    expect(Array.isArray(signalArg.indicators?.candles15m)).toBe(true);
    expect(Array.isArray(signalArg.indicators?.btcCandles15m)).toBe(true);
  });

  it('updates indicators on every candle even before first signal', async () => {
    let lowsCandlesSeen = 0;
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
          next: jest.fn(() => {
            if (options.mode === 'lows') {
              lowsCandlesSeen += 1;
              if (lowsCandlesSeen > 120) {
                return [line];
              }
            }
            return [];
          }),
        };
      },
    );

    const { createIndicators: createIndicatorsReal } =
      jest.requireActual('@utils/indicators');
    (createIndicators as jest.Mock).mockImplementation((data) =>
      createIndicatorsReal(data),
    );

    const cachedData: any[] = [];
    const btcCachedData: any[] = [];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      config: {
        ENV: 'BACKTEST',
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

    let firstSignal: any = null;
    const start = 1_700_000_000_000;
    for (let i = 0; i < 140; i += 1) {
      const candle = makeCandle(start + i * 900_000, 100 + i);
      const btcCandle = makeCandle(start + i * 900_000, 20000 + i);
      const result = await strategy(candle, btcCandle);
      if (!firstSignal && typeof result === 'object') {
        firstSignal = result;
      }
    }

    expect(firstSignal).toBeTruthy();
    expect(firstSignal.indicators.price24hPcnt).toHaveLength(50);
    expect(firstSignal.indicators.price1hPcnt).toHaveLength(50);
  });

  it('closes opposite positions on other symbols before opening in non-BACKTEST', async () => {
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

    (createIndicators as jest.Mock).mockImplementation(() => ({
      next: jest.fn(() => ({})),
      result: jest.fn(() => ({})),
    }));

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      getPositions: jest.fn(async () => [
        {
          symbol: 'AAVEUSDT',
          qty: 1,
          price: 120,
          direction: 'LONG',
        },
        {
          symbol: 'FARTCOINUSDT',
          qty: 2,
          price: 0.1,
          direction: 'SHORT',
        },
        {
          symbol: 'TESTUSDT',
          qty: 1,
          price: 101,
          direction: 'SHORT',
        },
      ]),
      closePosition: jest.fn(async () => true),
      placeOrder: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        CLOSE_OPPOSITE_POSITIONS: true,
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

    const candle = makeCandle(1_700_000_000_000, 101);
    const btcCandle = makeCandle(1_700_000_000_000, 20001);
    await strategy(candle, btcCandle);

    expect(connector.getPositions).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'FARTCOINUSDT',
        direction: 'SHORT',
      }),
    );
    expect(connector.placeOrder).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      'info',
      '[%s] closing opposite position: %s %s qty=%s',
      'TrendLine',
      'FARTCOINUSDT',
      'SHORT',
      2,
    );
  });

  it('does not request all positions in BACKTEST before opening', async () => {
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

    (createIndicators as jest.Mock).mockImplementation(() => ({
      next: jest.fn(() => ({})),
      result: jest.fn(() => ({})),
    }));

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      getPositions: jest.fn(async () => []),
      closePosition: jest.fn(async () => true),
      placeOrder: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      config: {
        ENV: 'BACKTEST',
        INTERVAL: '15',
        MAKE_ORDERS: true,
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

    const candle = makeCandle(1_700_000_000_000, 101);
    const btcCandle = makeCandle(1_700_000_000_000, 20001);
    await strategy(candle, btcCandle);

    expect(connector.getPositions).not.toHaveBeenCalled();
    expect(connector.closePosition).not.toHaveBeenCalled();
    expect(connector.placeOrder).toHaveBeenCalledTimes(1);
  });
});
