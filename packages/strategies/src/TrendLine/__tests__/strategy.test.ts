import { TrendlineStrategyCreator } from '../strategy';
import { askAI } from '@tradejs/node/strategies';
import {
  calculateCoinBtcCorrelation,
  createIndicators,
  createTrendlineEngine,
} from '@tradejs/core/indicators';
import { filterByVeryVolatilityCandles } from '../filters';
import { logger } from '@tradejs/infra/logger';
import { fetchMlThreshold } from '@tradejs/infra/ml';
import { getData, redisKeys } from '@tradejs/infra/redis';

jest.mock('@tradejs/core/indicators', () => {
  const actual = jest.requireActual('@tradejs/core/indicators');
  return {
    ...actual,
    calculateCoinBtcCorrelation: jest.fn(() => ({ correlation: 0 })),
    createIndicators: jest.fn(),
    createTrendlineEngine: jest.fn(),
  };
});

jest.mock('@tradejs/node/strategies', () => {
  const actual = jest.requireActual('@tradejs/node/strategies');
  return {
    ...actual,
    askAI: jest.fn(async () => ({
      direction: 'LONG',
      quality: 5,
      needRetest: false,
      retestPrice: null,
      takeProfitPrice: null,
      stopLossPrice: null,
      comment: 'ok',
    })),
  };
});

jest.mock('@tradejs/infra/redis', () => ({
  getData: jest.fn(async () => ({})),
  redisKeys: {
    strategyConfig: jest.fn(() => 'strategy:config:TrendLine'),
    strategyResults: jest.fn(() => 'strategy:results:TrendLine'),
  },
}));

jest.mock('@tradejs/infra/ml', () => ({
  ...jest.requireActual('@tradejs/infra/ml'),
  fetchMlThreshold: jest.fn(async () => null),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
  filterByVeryVolatilityCandles: jest.fn(() => true),
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

const makeFreshBreakoutTrendLine = (
  candle: ReturnType<typeof makeCandle>,
  mode: 'lows' | 'highs' = 'lows',
) => {
  const delta = candle.close * 0.006;

  return {
    id: 'line-1',
    mode,
    distance: 50,
    touches: [
      { timestamp: candle.timestamp - 2_700_000, value: candle.close + delta },
      { timestamp: candle.timestamp - 1_800_000, value: candle.close + delta },
      { timestamp: candle.timestamp - 900_000, value: candle.close + delta },
    ],
    points: [
      {
        timestamp: candle.timestamp - 900_000,
        value: mode === 'lows' ? candle.close + delta : candle.close - delta,
      },
      {
        timestamp: candle.timestamp,
        value: mode === 'lows' ? candle.close - delta : candle.close + delta,
      },
    ],
  };
};

describe('TrendlineStrategyCreator', () => {
  const originalDerivativesContextEnabled =
    process.env.DERIVATIVES_CONTEXT_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'false';
    (calculateCoinBtcCorrelation as jest.Mock).mockReturnValue({
      correlation: 0,
    });
    (filterByVeryVolatilityCandles as jest.Mock).mockReturnValue(true);
    (getData as jest.Mock).mockImplementation(async () => ({}));
    (askAI as jest.Mock).mockResolvedValue({
      direction: 'LONG',
      quality: 5,
      needRetest: false,
      retestPrice: null,
      takeProfitPrice: null,
      stopLossPrice: null,
      comment: 'ok',
    });
  });

  afterAll(() => {
    if (originalDerivativesContextEnabled === undefined) {
      delete process.env.DERIVATIVES_CONTEXT_ENABLED;
    } else {
      process.env.DERIVATIVES_CONTEXT_ENABLED =
        originalDerivativesContextEnabled;
    }
  });

  it('stores 10 indicator values and exposes them in signal', async () => {
    (createTrendlineEngine as jest.Mock).mockImplementation(
      (_data, options) => ({
        next: jest.fn((candle) => [
          makeFreshBreakoutTrendLine(candle as any, options.mode ?? 'lows'),
        ]),
      }),
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
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: false,
        ML_ENABLED: true,
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
      const nextResult = await strategy(candle, btcCandle);
      if (!result && typeof nextResult === 'object') {
        result = nextResult;
      }
    }

    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
    expect(result.indicators.maFast).toHaveLength(10);
    expect(result.indicators.atrPct).toHaveLength(10);
    expect(result.indicators.smaObv).toHaveLength(10);
    expect(result.indicators.price24hPcnt).toHaveLength(10);
    expect(result.indicators.volume24h).toHaveLength(10);
  });

  it('keeps indicator history isolated between sequential signals', async () => {
    (createTrendlineEngine as jest.Mock).mockImplementation(
      (_data, options) => ({
        next: jest.fn((candle) => [
          makeFreshBreakoutTrendLine(candle as any, options.mode ?? 'lows'),
        ]),
      }),
    );

    let value = 0;
    (createIndicators as jest.Mock).mockImplementation(() => {
      const indicatorHistory: Record<string, number[]> = { maFast: [] };
      return {
        next: jest.fn(() => {
          value += 1;
          indicatorHistory.maFast.push(value);
          return { maFast: value };
        }),
        result: jest.fn(() => ({
          maFast: indicatorHistory.maFast.slice(),
        })),
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
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: false,
        ML_ENABLED: true,
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

    const signalA = await strategy(
      makeCandle(1_700_000_000_000, 100),
      makeCandle(1_700_000_000_000, 20000),
    );
    const signalB = await strategy(
      makeCandle(1_700_000_900_000, 101),
      makeCandle(1_700_000_900_000, 20001),
    );

    expect(typeof signalA).toBe('object');
    expect(typeof signalB).toBe('object');
    expect((signalA as any).indicators.maFast).toEqual([1]);
    expect((signalB as any).indicators.maFast).toEqual([1, 2]);
    expect((signalA as any).indicators.maFast).not.toBe(
      (signalB as any).indicators.maFast,
    );
  });

  it('merges user strategy config from redis in non-BACKTEST mode', async () => {
    (getData as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'strategy:config:TrendLine') {
        return {
          LOWS: {
            enable: false,
          },
        };
      }
      return {};
    });

    (createTrendlineEngine as jest.Mock).mockImplementation(
      (_data, options) => ({
        next: jest.fn((candle) => [
          makeFreshBreakoutTrendLine(candle as any, options.mode ?? 'lows'),
        ]),
      }),
    );

    (createIndicators as jest.Mock).mockImplementation(() => ({
      next: jest.fn(() => ({})),
      result: jest.fn(() => ({})),
    }));

    const cachedData: any[] = [makeCandle(1, 100)];
    const btcCachedData: any[] = [makeCandle(1, 20000)];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: false,
        ML_ENABLED: true,
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

    const result = await strategy(
      makeCandle(1_700_000_000_000, 100),
      makeCandle(1_700_000_000_000, 20000),
    );

    expect(redisKeys.strategyConfig).toHaveBeenCalledWith('test', 'TrendLine');
    expect(result).toBe('STRATEGY_DISABLED');
  });

  it('applies backtest result config after user config and marks signal isConfigFromBacktest', async () => {
    (getData as jest.Mock).mockImplementation(async (key: string) => {
      if (key === 'strategy:config:TrendLine') {
        return {
          LOWS: {
            enable: false,
          },
        };
      }

      if (key === 'strategy:results:TrendLine') {
        return {
          TESTUSDT: {
            config: {
              LOWS: {
                enable: true,
                direction: 'LONG',
                TP: 2,
                SL: 1,
                minRiskRatio: 0,
              },
            },
            stats: {},
          },
        };
      }

      return {};
    });

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
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
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

    const result = await strategy(
      makeCandle(1_700_000_000_000, 100),
      makeCandle(1_700_000_000_000, 20000),
    );

    expect(typeof result).toBe('object');
    expect((result as any).isConfigFromBacktest).toBe(true);
    expect(redisKeys.strategyResults).toHaveBeenCalledWith('test', 'TrendLine');
  });

  it('returns VERY_VOLATILITY when filter fails', async () => {
    (filterByVeryVolatilityCandles as jest.Mock).mockReturnValue(false);
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
      connectorName: 'ByBit',
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
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: false,
        ML_ENABLED: true,
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
    const [requestArg] = (fetchMlThreshold as jest.Mock).mock.calls[0] as any[];
    expect(requestArg.candles).toBeUndefined();
    expect(requestArg.btcCandles).toBeUndefined();
    expect(requestArg.features.candles15m).toBeUndefined();
    expect(requestArg.features.btcCandles15m).toBeUndefined();
  });

  it('updates indicators on every candle even before first signal', async () => {
    let lowsCandlesSeen = 0;
    (createTrendlineEngine as jest.Mock).mockImplementation(
      (_data, options) => {
        return {
          next: jest.fn((candle) => {
            if (options.mode === 'lows') {
              lowsCandlesSeen += 1;
              if (lowsCandlesSeen > 120) {
                return [
                  makeFreshBreakoutTrendLine(
                    candle as ReturnType<typeof makeCandle>,
                    options.mode ?? 'lows',
                  ),
                ];
              }
            }
            return [];
          }),
        };
      },
    );

    (createIndicators as jest.Mock).mockImplementation(() => {
      const history: Record<string, number[]> = {
        price24hPcnt: [],
        price1hPcnt: [],
      };

      const trim50 = (values: number[]) =>
        values.length > 50 ? values.slice(values.length - 50) : values;

      return {
        next: jest.fn((_candle: any) => {
          const next24h = trim50([...history.price24hPcnt, 1]);
          const next1h = trim50([...history.price1hPcnt, 1]);
          history.price24hPcnt = next24h;
          history.price1hPcnt = next1h;
          return {} as any;
        }),
        result: jest.fn(() => history),
      };
    });

    const cachedData: any[] = [];
    const btcCachedData: any[] = [];
    const connector: any = {
      getPosition: jest.fn(async () => ({ qty: 0 })),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
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

    const start = 1_700_000_000_000;
    for (let i = 0; i < 140; i += 1) {
      const candle = makeCandle(start + i * 900_000, 100 + i);
      const btcCandle = makeCandle(start + i * 900_000, 20000 + i);
      await strategy(candle, btcCandle);
    }

    const indicatorsInstance = (createIndicators as jest.Mock).mock.results[0]
      ?.value;
    const history = indicatorsInstance?.result();

    expect(history).toBeTruthy();
    expect(history.price24hPcnt).toHaveLength(50);
    expect(history.price1hPcnt).toHaveLength(50);
  });

  it('closes opposite positions on other symbols before opening in non-BACKTEST', async () => {
    (fetchMlThreshold as jest.Mock).mockResolvedValue({
      passed: true,
      threshold: 0.1,
      score: 0.2,
    });

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
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        CLOSE_OPPOSITE_POSITIONS: true,
        AI_ENABLED: false,
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
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
      config: {
        ENV: 'BACKTEST',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        BACKTEST_ENTRY_DELAY_BARS: 0,
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

  it('skips order in non-BACKTEST when AI quality is unavailable even if MIN_AI_QUALITY is 0', async () => {
    (fetchMlThreshold as jest.Mock).mockResolvedValue({
      passed: true,
      threshold: 0.1,
      probability: 0.9,
    });

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
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        AI_ENABLED: true,
        MIN_AI_QUALITY: 0,
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

    const result = await strategy(
      makeCandle(1_700_000_000_000, 100),
      makeCandle(1_700_000_000_000, 20000),
    );

    expect(typeof result).toBe('object');
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe('AI_QUALITY_UNAVAILABLE');
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });

  it('skips order in non-BACKTEST when ML threshold rejects the signal', async () => {
    (fetchMlThreshold as jest.Mock).mockResolvedValue({
      passed: false,
      threshold: 0.5,
      probability: 0.4,
    });

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
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        AI_ENABLED: false,
        ML_ENABLED: true,
        ML_THRESHOLD: 0.5,
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

    const result = await strategy(
      makeCandle(1_700_000_000_000, 100),
      makeCandle(1_700_000_000_000, 20000),
    );

    expect(typeof result).toBe('object');
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe(
      'ML_THRESHOLD_NOT_MET (0.4 < 0.5)',
    );
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });

  it('skips order in non-BACKTEST when ML result is unavailable', async () => {
    (fetchMlThreshold as jest.Mock).mockResolvedValue(null);

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
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      kline: jest.fn(async () => cachedData),
    };

    const strategy = await TrendlineStrategyCreator({
      userName: 'test',
      connectorName: 'ByBit',
      config: {
        ENV: 'test',
        INTERVAL: '15',
        MAKE_ORDERS: true,
        AI_ENABLED: false,
        ML_ENABLED: true,
        ML_THRESHOLD: 0.5,
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

    const result = await strategy(
      makeCandle(1_700_000_000_000, 100),
      makeCandle(1_700_000_000_000, 20000),
    );

    expect(typeof result).toBe('object');
    expect((result as any).orderStatus).toBe('skipped');
    expect((result as any).orderSkipReason).toBe('ML_RESULT_UNAVAILABLE');
    expect(connector.placeOrder).not.toHaveBeenCalled();
  });
});
