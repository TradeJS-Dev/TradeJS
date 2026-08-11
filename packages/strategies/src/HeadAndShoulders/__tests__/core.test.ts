/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createHeadAndShouldersCore } from '../core';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeClassicCandles = () => [
  makeCandle(0, 100, 102, 98, 100),
  makeCandle(1, 100, 110, 99, 105),
  makeCandle(2, 105, 105, 98, 104),
  makeCandle(3, 104, 104, 95, 97),
  makeCandle(4, 97, 108, 98, 105),
  makeCandle(5, 105, 120, 103, 117),
  makeCandle(6, 117, 110, 99, 103),
  makeCandle(7, 103, 106, 96, 98),
  makeCandle(8, 98, 109, 100, 106),
  makeCandle(9, 106, 111, 102, 109),
  makeCandle(10, 109, 105, 97, 99),
  makeCandle(11, 99, 101, 92, 94),
];

const makeConfig = () =>
  ({
    ...DEFAULT_CONFIG,
    HEADSHOULDERS_PIVOT_LOOKBACK: 1,
    HEADSHOULDERS_SHOULDER_TOLERANCE_PCT: 50,
    HEADSHOULDERS_MIN_HEAD_PROMINENCE_RATIO: 0.1,
    HEADSHOULDERS_MIN_HEAD_HEIGHT_PCT: 0,
    HEADSHOULDERS_MIN_HEAD_HEIGHT_ATR: 0,
    HEADSHOULDERS_MIN_PATTERN_BARS: 4,
    HEADSHOULDERS_MIN_PATTERN_SYMMETRY_RATIO: 0,
    HEADSHOULDERS_MAX_NECKLINE_SLOPE_RATIO: 1,
    HEADSHOULDERS_MAX_PRIOR_MOVE_ATR: 0,
    HEADSHOULDERS_MIN_BREAKOUT_DISTANCE_ATR: 0,
    HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO: 0,
    HEADSHOULDERS_MAX_BREAKOUT_DISTANCE_PCT: 5,
    HEADSHOULDERS_ENTRY_MODE: 'breakout',
    SHORT: { ...DEFAULT_CONFIG.SHORT, minRiskRatio: 0.5 },
  }) as any;

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({ baseContext: {} })),
    latestNumber: jest.fn(() => undefined),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeStrategyApi = ({
  marketData,
  currentPosition = null,
}: {
  marketData: any;
  currentPosition?: any;
}) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getDecisionPriceContext: jest.fn(async () => ({
      timestamp: marketData.timestamp,
      currentPrice: marketData.currentPrice,
      candle: marketData.lastCandle,
    })),
    getCurrentPosition: jest.fn(async () => currentPosition),
    getBaseContext: jest.fn(() => ({
      regime: { momentum: { bodyStrength: 1 } },
    })),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: () => false,
      markTrade: jest.fn(),
      getLastTradeTimestamp: () => null,
    })),
    createStateController: createTestStateController(),
    entry: jest.fn(async (params: any) => ({
      kind: 'entry',
      code: params.code,
      entryContext: {
        strategy: 'HeadAndShoulders',
        direction: params.direction,
      },
      orderPlan: params.orderPlan,
      signal: {
        strategy: 'HeadAndShoulders',
        direction: params.direction,
        figures: params.figures,
        indicators: params.indicators,
        additionalIndicators: params.additionalIndicators,
      },
    })),
    exit: jest.fn(async (params: any) => ({
      kind: 'exit',
      code: params.code,
      closePlan: { direction: params.direction },
    })),
  }) as any;

const createCore = async (
  currentPosition: any = null,
  configOverrides: Record<string, unknown> = {},
) => {
  const candles = makeClassicCandles();
  const currentCandle = candles[candles.length - 1];
  const strategyApi = makeStrategyApi({
    marketData: {
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
      lastCandle: currentCandle,
    },
    currentPosition,
  });
  const core = await createHeadAndShouldersCore({
    userName: 'root',
    symbol: 'TESTUSDT',
    config: { ...makeConfig(), ...configOverrides },
    isConfigFromBacktest: false,
    connector: {} as any,
    data: candles.slice(0, -1),
    btcData: candles.slice(0, -1),
    loadPineScriptFile: jest.fn(),
    strategyApi,
    indicatorsState: makeIndicatorsState(),
  });
  return { core, currentCandle, strategyApi };
};

describe('HeadAndShoulders core', () => {
  it('creates a sized short entry with geometry and signal context', async () => {
    const { core, currentCandle } = await createCore();

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result.kind).toBe('entry');
    expect((result as any).code).toBe('HEADSHOULDERS_CLASSIC_BREAKOUT');
    expect((result as any).entryContext.direction).toBe('SHORT');
    expect((result as any).orderPlan.qty).toBeGreaterThan(0);
    expect((result as any).signal.figures.lines).toHaveLength(4);
    expect(
      (result as any).signal.additionalIndicators.headAndShouldersContext
        .patternKind,
    ).toBe('head_and_shoulders');
  });

  it('exits an opposite long position on a classic pattern', async () => {
    const { core, currentCandle, strategyApi } = await createCore(
      {
        direction: 'LONG',
        price: 100,
        qty: 1,
      },
      { HEADSHOULDERS_EXIT_ON_OPPOSITE_PATTERN: true },
    );

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result).toEqual({
      kind: 'exit',
      code: 'HEADSHOULDERS_OPPOSITE_PATTERN_EXIT',
      closePlan: { direction: 'LONG' },
    });
    expect(strategyApi.exit).toHaveBeenCalledWith({
      code: 'HEADSHOULDERS_OPPOSITE_PATTERN_EXIT',
      direction: 'LONG',
    });
  });

  it('keeps an existing position when opposite-pattern exits are disabled', async () => {
    const { core, currentCandle, strategyApi } = await createCore({
      direction: 'LONG',
      price: 100,
      qty: 1,
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result).toEqual({ kind: 'skip', code: 'POSITION_EXISTS' });
    expect(strategyApi.exit).not.toHaveBeenCalled();
  });
});
