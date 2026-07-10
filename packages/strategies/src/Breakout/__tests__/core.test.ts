import { createBreakoutCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

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

const makeConfig = (overrides: Record<string, any> = {}) => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const makeStrategyApi = (overrides: Record<string, any> = {}) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getCurrentIndicatorsContext: jest.fn(() => {
      const indicators =
        overrides.indicators ??
        overrides.nextIndicators?.(overrides.candle, overrides.btcCandle);
      return {
        indicators,
        baseContext: indicators?.baseContext,
      };
    }),
    getBaseContext: jest.fn(() => overrides.indicators?.baseContext),
    getDecisionPriceContext: jest.fn(async () => ({
      timestamp: overrides.marketData?.timestamp,
      currentPrice: overrides.marketData?.currentPrice,
      candle: overrides.marketData?.lastCandle,
    })),
    getCurrentPosition: jest.fn(async () => overrides.currentPosition),
    getDirectionalTpSlPrices: jest.fn(
      ({
        price,
        direction,
        takeProfitDelta,
        stopLossDelta,
        unit = 'percent',
      }) => {
        const factor = unit === 'percent' ? 100 : 1;
        const tp = takeProfitDelta / factor;
        const sl = stopLossDelta / factor;
        const isLong = direction === 'LONG';
        return {
          stopLossPrice: isLong ? price * (1 - sl) : price * (1 + sl),
          takeProfitPrice: isLong ? price * (1 + tp) : price * (1 - tp),
        };
      },
    ),
    createLastTradeController: jest.fn(),
    exit: jest.fn(async (params: any) => ({
      kind: 'exit',
      code: params.code,
      closePlan: {
        price: overrides.marketData?.currentPrice,
        timestamp: overrides.marketData?.timestamp,
        direction: params.direction,
      },
    })),
    entry: (params: any) => {
      const marketData = overrides.marketData ?? {};
      const currentPrice = Number(marketData.currentPrice ?? 0);
      const timestamp = Number(marketData.timestamp ?? 0);
      const takeProfitPrices = Array.isArray(params.orderPlan?.takeProfits)
        ? params.orderPlan.takeProfits.map((tp: any) => Number(tp.price))
        : [];
      const takeProfitPrice =
        params.direction === 'LONG'
          ? Math.max(...takeProfitPrices)
          : Math.min(...takeProfitPrices);
      const stopLossPrice = Number(
        params.orderPlan?.stopLossPrice ?? currentPrice,
      );
      const reward =
        params.direction === 'LONG'
          ? takeProfitPrice - currentPrice
          : currentPrice - takeProfitPrice;
      const risk =
        params.direction === 'LONG'
          ? currentPrice - stopLossPrice
          : stopLossPrice - currentPrice;

      return {
        kind: 'entry',
        code: params.code ?? `BREAKOUT_${params.direction}_ENTRY`,
        entryContext: {
          strategy: 'Breakout',
          symbol: 'TESTUSDT',
          interval: '15',
          direction: params.direction,
          timestamp,
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio: risk > 0 ? reward / risk : 0,
          },
          isConfigFromBacktest: false,
        },
        orderPlan: params.orderPlan,
        runtime: params.runtime,
        signal: {
          signalId: params.signalId ?? 'test-signal-id',
          strategy: 'Breakout',
          symbol: 'TESTUSDT',
          interval: '15',
          direction: params.direction,
          timestamp,
          figures: params.figures ?? {},
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio: risk > 0 ? reward / risk : 0,
          },
          indicators: params.indicators ?? {},
          additionalIndicators: params.additionalIndicators,
          isConfigFromBacktest: false,
        },
      };
    },
  }) as any;

const makeIndicatorSnapshot = (
  candle: any,
  overrides: Record<string, any> = {},
) => {
  const snapshot = {
    candle,
    prevCandle: makeCandle(candle.timestamp - 60_000, candle.close - 1),
    highLevel: candle.close - 2,
    lowLevel: candle.close + 2,
    maFast: candle.close + 1,
    maSlow: candle.close - 1,
    smaObv: 100,
    obv: 200,
    atr: 1,
    bbUpper: candle.close - 1,
    bbLower: candle.close + 1,
    correlation: 0.1,
    ...overrides,
  };

  return {
    ...snapshot,
    baseContext: {
      raw: {
        trend: {
          maFast: snapshot.maFast,
          maMedium: null,
          maSlow: snapshot.maSlow,
        },
        volatility: {
          atr: snapshot.atr,
          atrPct: null,
          bbUpper: snapshot.bbUpper,
          bbMiddle: null,
          bbLower: snapshot.bbLower,
          bbWidthPct: null,
        },
        momentum: {
          macd: null,
          macdSignal: null,
          macdHistogram: null,
        },
        volume: {
          volume: snapshot.candle.volume,
          turnover: snapshot.candle.turnover,
          obv: snapshot.obv,
          obvSma: snapshot.smaObv,
          volume1h: null,
          volume24h: null,
        },
        price: {
          prevClose: snapshot.prevCandle.close,
          price1hPct: null,
          price24hPct: null,
          highPrice1h: null,
          lowPrice1h: null,
          highPrice24h: null,
          lowPrice24h: null,
        },
        levels: {
          highLevel: snapshot.highLevel,
          lowLevel: snapshot.lowLevel,
        },
        crossAsset: {
          btcCorrelation: snapshot.correlation,
          venueSpread: null,
        },
      },
    },
  };
};

describe('createBreakoutCore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns skip decision for empty candle', async () => {
    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(),
      isInitialized: jest.fn(() => true),
    };
    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: undefined,
        nextIndicators: (...args: any[]) =>
          (indicatorsState as any).next(...args),
      }),
      indicatorsState: indicatorsState as any,
    });

    await expect(core({} as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'NO_DATA',
    });
  });

  it('returns entry decision for long breakout', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);

    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(() =>
        makeIndicatorSnapshot(candle, {
          maFast: 110,
          maSlow: 90,
          obv: 200,
          smaObv: 100,
          atr: 1,
          prevCandle: {
            ...makeCandle(candle.timestamp - 60_000, 99),
            high: 120,
            close: 99,
          },
          highLevel: 100,
          bbUpper: 95,
        }),
      ),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(),
      isInitialized: jest.fn(() => true),
    };

    const config = makeConfig({
      REQUIRED_SCORE_LONG: 3,
      SIGNALS_LONG: {
        VOLATILE: { weight: 1, required: true },
        SMA_UPTREND: { weight: 1, required: true },
        OBV_ABOVE_SMA: { weight: 1, required: true },
      },
      REQUIRED_SCORE_SHORT: 99,
      SIGNALS_SHORT: {},
    });

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config,
      isConfigFromBacktest: false,
      connector: {
        getPosition: jest.fn(),
      } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: {
          symbol: 'TESTUSDT',
          qty: 0,
          price: 0,
          direction: 'LONG',
        },
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: (_nextCandle: any, _nextBtcCandle: any) =>
          indicatorsState.next(),
      }),
      indicatorsState: indicatorsState as any,
    });

    const result = await core(candle, {} as any);

    expect(result.kind).toBe('entry');
    if (result.kind !== 'entry') return;
    expect(result.code).toBe('OPEN_LONG');
    expect(result.entryContext.direction).toBe('LONG');
    expect(result.orderPlan.qty).toBeCloseTo(config.LIMIT / candle.close);
    expect(result.orderPlan.stopLossPrice).toBeCloseTo(
      candle.close * (1 - config.SL_LONG),
    );
    expect(result.orderPlan.takeProfits?.length).toBe(config.TP_LONG.length);
  });

  it('returns exit decision for reverse signal on open position', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);

    const indicatorsState = {
      setCurrentBar: jest.fn(),
      next: jest.fn(() =>
        makeIndicatorSnapshot(candle, {
          maFast: 90,
          maSlow: 110,
          obv: 50,
          smaObv: 100,
          atr: 1,
          prevCandle: {
            ...makeCandle(candle.timestamp - 60_000, 101),
            low: 80,
            close: 101,
          },
          lowLevel: 95,
          bbLower: 105,
        }),
      ),
      onBar: jest.fn(),
      ensureInitializedWithCurrentBar: jest.fn(),
      snapshot: jest.fn(),
      latestNumber: jest.fn(),
      isInitialized: jest.fn(() => true),
    };

    const config = makeConfig({
      REQUIRED_SCORE_LONG: 99,
      SIGNALS_LONG: {},
      REQUIRED_SCORE_SHORT: 3,
      SIGNALS_SHORT: {
        VOLATILE: { weight: 1, required: true },
        SMA_DOWNTREND: { weight: 1, required: true },
        OBV_BELOW_SMA: { weight: 1, required: true },
      },
    });

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config,
      isConfigFromBacktest: false,
      connector: {
        getPosition: jest.fn(),
      } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: {
          symbol: 'TESTUSDT',
          qty: 1,
          direction: 'LONG',
          price: 100,
        },
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: (_nextCandle: any, _nextBtcCandle: any) =>
          indicatorsState.next(),
      }),
      indicatorsState: indicatorsState as any,
    });

    const result = await core(candle, {} as any);

    expect(result).toEqual({
      kind: 'exit',
      code: 'CLOSE_POSITION_BY_OPEN_SIGNAL',
      closePlan: {
        price: candle.close,
        timestamp: candle.timestamp,
        direction: 'LONG',
      },
    });
  });

  it('returns skip when indicators are not available', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: undefined,
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: () => undefined,
      }),
      indicatorsState: {} as any,
    });

    const result = await core(candle, {} as any);
    expect(result).toEqual({
      kind: 'skip',
      code: 'NO_INDICATORS',
    });
  });

  it('returns WAIT_DATA when required indicator fields are missing', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: undefined,
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: () => ({
          candle,
          prevCandle: null,
          highLevel: null,
          lowLevel: null,
        }),
      }),
      indicatorsState: {} as any,
    });

    const result = await core(candle, {} as any);
    expect(result).toEqual({
      kind: 'skip',
      code: 'WAIT_DATA',
    });
  });

  it('returns entry decision for short breakout', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);

    const config = makeConfig({
      REQUIRED_SCORE_LONG: 99,
      SIGNALS_LONG: {},
      REQUIRED_SCORE_SHORT: 3,
      SIGNALS_SHORT: {
        VOLATILE: { weight: 1, required: true },
        SMA_DOWNTREND: { weight: 1, required: true },
        OBV_BELOW_SMA: { weight: 1, required: true },
      },
    });

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config,
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: {
          symbol: 'TESTUSDT',
          qty: 0,
          direction: 'LONG',
          price: 0,
        },
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: () =>
          makeIndicatorSnapshot(candle, {
            maFast: 90,
            maSlow: 110,
            obv: 50,
            smaObv: 100,
            atr: 1,
            prevCandle: {
              ...makeCandle(candle.timestamp - 60_000, 101),
              low: 80,
              close: 101,
            },
            lowLevel: 95,
            bbLower: 105,
          }),
      }),
      indicatorsState: {} as any,
    });

    const result = await core(candle, {} as any);

    expect(result.kind).toBe('entry');
    if (result.kind !== 'entry') {
      return;
    }
    expect(result.code).toBe('OPEN_SHORT');
    expect(result.entryContext.direction).toBe('SHORT');
    expect(result.orderPlan.qty).toBeCloseTo(config.LIMIT / candle.close);
    expect(result.orderPlan.stopLossPrice).toBeCloseTo(
      candle.close * (1 + config.SL_SHORT),
    );
    expect(result.orderPlan.takeProfits?.length).toBe(config.TP_SHORT.length);
  });

  it('returns NO_SIGNAL when no entry conditions match and no position exists', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);
    const strategyApi = makeStrategyApi({
      currentPosition: {
        symbol: 'TESTUSDT',
        qty: 0,
        direction: 'LONG',
        price: 0,
      },
      marketData: {
        currentPrice: candle.close,
        timestamp: candle.timestamp,
        fullData: [candle],
        lastCandle: candle,
      },
      nextIndicators: () =>
        makeIndicatorSnapshot(candle, {
          maFast: 100,
          maSlow: 100,
          obv: 100,
          smaObv: 100,
          prevCandle: {
            ...makeCandle(candle.timestamp - 60_000, 100),
            high: 100,
            low: 100,
            close: 100,
          },
          highLevel: 100,
          lowLevel: 100,
          bbUpper: 100,
          bbLower: 100,
        }),
    });

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        REQUIRED_SCORE_LONG: 1,
        SIGNALS_LONG: {
          SMA_UPTREND: { weight: 1, required: true },
        },
        REQUIRED_SCORE_SHORT: 1,
        SIGNALS_SHORT: {
          SMA_DOWNTREND: { weight: 1, required: true },
        },
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi,
      indicatorsState: {} as any,
    });

    const result = await core(candle, {} as any);
    expect(result).toEqual({
      kind: 'skip',
      code: 'NO_SIGNAL',
    });
    expect(strategyApi.getDecisionPriceContext).not.toHaveBeenCalled();
  });

  it('returns CLOSE_POSITION_BY_SMA on adverse trend for open position', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        REQUIRED_SCORE_SHORT: 99,
        SIGNALS_SHORT: {},
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: {
          symbol: 'TESTUSDT',
          qty: 1,
          direction: 'LONG',
          price: 100,
        },
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: () =>
          makeIndicatorSnapshot(candle, {
            maFast: 90,
            maSlow: 110,
            obv: 200,
            smaObv: 100,
          }),
      }),
      indicatorsState: {} as any,
    });

    const result = await core(candle, {} as any);
    expect(result).toEqual({
      kind: 'exit',
      code: 'CLOSE_POSITION_BY_SMA',
      closePlan: {
        price: candle.close,
        timestamp: candle.timestamp,
        direction: 'LONG',
      },
    });
  });

  it('returns POSITION_HELD when position exists and no exit triggers fire', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig({
        REQUIRED_SCORE_SHORT: 99,
        SIGNALS_SHORT: {},
      }),
      isConfigFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
      loadPineScriptFile: jest.fn(() => ''),
      strategyApi: makeStrategyApi({
        currentPosition: {
          symbol: 'TESTUSDT',
          qty: 1,
          direction: 'LONG',
          price: 100,
        },
        marketData: {
          currentPrice: candle.close,
          timestamp: candle.timestamp,
          fullData: [candle],
          lastCandle: candle,
        },
        nextIndicators: () =>
          makeIndicatorSnapshot(candle, {
            maFast: 110,
            maSlow: 90,
            obv: 200,
            smaObv: 100,
          }),
      }),
      indicatorsState: {} as any,
    });

    const result = await core(candle, {} as any);
    expect(result).toEqual({
      kind: 'skip',
      code: 'POSITION_HELD',
    });
  });
});
