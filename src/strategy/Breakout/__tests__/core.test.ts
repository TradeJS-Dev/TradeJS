import { createIndicators } from '@utils/indicators';

jest.mock('@utils/strategyHelpers', () => ({
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
    configFromBacktest: params.configFromBacktest,
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
      configFromBacktest: params.entryContext.configFromBacktest,
    },
  })),
  buildEntryOrderPlan: jest.fn((params) => params),
  buildEntryRuntimePolicy: jest.fn((params) => params),
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

const makeIndicatorSnapshot = (candle: any, overrides: Record<string, any> = {}) => ({
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
    (createIndicators as jest.Mock).mockImplementation(() => ({
      next: jest.fn(),
    }));

    const core = await createBreakoutCore({
      userName: 'test',
      symbol: 'TESTUSDT',
      config: makeConfig(),
      configFromBacktest: false,
      connector: { getPosition: jest.fn() } as any,
      data: [],
      btcData: [],
    });

    await expect(core({} as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'NO_DATA',
    });
  });

  it('returns entry decision for long breakout', async () => {
    const candle = makeCandle(1_700_000_000_000, 100);

    (createIndicators as jest.Mock).mockImplementation(() => ({
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
    }));

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
      configFromBacktest: false,
      connector: {
        getPosition: jest.fn(async () => ({
          symbol: 'TESTUSDT',
          qty: 0,
          price: 0,
          direction: 'LONG',
        })),
      } as any,
      data: [],
      btcData: [],
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

    (createIndicators as jest.Mock).mockImplementation(() => ({
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
    }));

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
      configFromBacktest: false,
      connector: {
        getPosition: jest.fn(async () => ({
          symbol: 'TESTUSDT',
          qty: 1,
          direction: 'LONG',
          price: 100,
        })),
      } as any,
      data: [],
      btcData: [],
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
