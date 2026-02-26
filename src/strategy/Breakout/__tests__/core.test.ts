import { createIndicators } from '@utils/indicators';

jest.mock('@utils/strategyHelpers', () => ({
  createStrategyAPI: jest.fn((params) => ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getMarketData: jest.fn(),
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(),
    isCurrentPositionExists: jest.fn(),
    getDirectionalTpSlPrices: jest.fn(),
    createLastTradeController: jest.fn(),
    entry: (entryParams: any) => ({
      kind: 'entry',
      code: entryParams.code,
      entryContext: {
        strategy: params?.strategy ?? 'Breakout',
        symbol: params?.symbol ?? 'TESTUSDT',
        interval: params?.interval ?? '15',
        direction: entryParams.direction,
        timestamp: entryParams.timestamp,
        prices: entryParams.prices,
        isConfigFromBacktest: params?.isConfigFromBacktest,
      },
      orderPlan: entryParams.orderPlan,
      runtime: entryParams.runtime,
      signal: {
        signalId: entryParams.signalId ?? 'test-signal-id',
        strategy: params?.strategy ?? 'Breakout',
        symbol: params?.symbol ?? 'TESTUSDT',
        interval: params?.interval ?? '15',
        direction: entryParams.direction,
        timestamp: entryParams.timestamp,
        figures: entryParams.figures ?? {},
        prices: entryParams.prices,
        indicators: entryParams.indicators ?? {},
        additionalIndicators: entryParams.additionalIndicators,
        isConfigFromBacktest: params?.isConfigFromBacktest,
      },
    }),
  })),
  mapMlRuntimeFromConfig: jest.fn((config, overrides = {}) => ({
    enabled: Boolean(config?.ML_ENABLED ?? true),
    mlThreshold: Number(config?.ML_THRESHOLD ?? 0),
    ...overrides,
  })),
  buildDefaultIndicatorPeriods: jest.fn(() => ({})),
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
  buildStrategySignal: jest.fn((params) => ({
    signalId: params.signalId,
    strategy: params.strategy,
    symbol: params.symbol,
    interval: params.interval,
    direction: params.direction,
    timestamp: params.timestamp,
    figures: params.figures ?? {},
    prices: params.prices,
    indicators: params.indicators ?? {},
    additionalIndicators: params.additionalIndicators,
    isConfigFromBacktest: params.isConfigFromBacktest,
  })),
  buildEntrySignalDecision: jest.fn((params) => ({
    kind: 'entry',
    code: params.code,
    entryContext: params.entryContext,
    orderPlan: params.orderPlan,
    runtime: params.runtime,
    signal: {
      signalId: params.signalId ?? 'test-signal-id',
      strategy: params.entryContext.strategy,
      symbol: params.entryContext.symbol,
      interval: params.entryContext.interval,
      direction: params.entryContext.direction,
      timestamp: params.entryContext.timestamp,
      figures: params.figures ?? {},
      prices: params.entryContext.prices,
      indicators: params.indicators ?? {},
      additionalIndicators: params.additionalIndicators,
      isConfigFromBacktest: params.entryContext.isConfigFromBacktest,
    },
  })),
}));

import { createBreakoutCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

jest.mock('@utils/indicators', () => {
  const actual = jest.requireActual('@utils/indicators');
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

const makeConfig = (overrides: Record<string, any> = {}) => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

const makeStrategyApi = (overrides: Record<string, any> = {}) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getMarketData: jest.fn(async () => overrides.marketData),
    nextIndicators: jest.fn((candle: any, btcCandle: any) =>
      overrides.nextIndicators?.(candle, btcCandle),
    ),
    getCurrentPosition: jest.fn(async () => overrides.currentPosition),
    isCurrentPositionExists: jest.fn(async () =>
      Boolean(overrides.currentPosition?.qty > 0),
    ),
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
    entry: (params: any) => ({
      kind: 'entry',
      code: params.code,
      entryContext: {
        strategy: 'Breakout',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: params.timestamp,
        prices: params.prices,
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
        timestamp: params.timestamp,
        figures: params.figures ?? {},
        prices: params.prices,
        indicators: params.indicators ?? {},
        additionalIndicators: params.additionalIndicators,
        isConfigFromBacktest: false,
      },
    }),
  }) as any;

const makeIndicatorSnapshot = (
  candle: any,
  overrides: Record<string, any> = {},
) => ({
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
  ...overrides,
});

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
});
