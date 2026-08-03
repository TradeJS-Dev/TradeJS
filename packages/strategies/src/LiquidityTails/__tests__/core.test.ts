/** @jest-environment node */

import { config as DEFAULT_CONFIG, LiquidityTailsConfig } from '../config';
import { createLiquidityTailsCore } from '../core';
import {
  createLiquidityTailsEngine,
  LiquidityTailsRuntimeState,
  LiquidityTailsSignal,
} from '../engine';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

jest.mock('../engine', () => {
  const actual = jest.requireActual('../engine');
  return { ...actual, createLiquidityTailsEngine: jest.fn() };
});

const mockedCreateLiquidityTailsEngine =
  createLiquidityTailsEngine as jest.MockedFunction<
    typeof createLiquidityTailsEngine
  >;

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close - 0.2,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeSignal = ({
  timestamp,
  close,
  direction = 'LONG',
  zoneId = `zone-${timestamp}`,
}: {
  timestamp: number;
  close: number;
  direction?: 'LONG' | 'SHORT';
  zoneId?: string;
}): LiquidityTailsSignal => {
  const isLong = direction === 'LONG';
  const top = isLong ? 95 : 110;
  const bottom = isLong ? 90 : 105;

  return {
    direction,
    zone: {
      id: zoneId,
      kind: isLong ? 'buy_pressure' : 'sell_pressure',
      direction,
      top,
      bottom,
      mid: (top + bottom) / 2,
      birthIndex: 1,
      birthTimestamp: timestamp - 1,
      touches: 1,
      lastTouchIndex: 1,
      originVolume: 1_000,
      spent: false,
      traded: true,
    },
    timestamp,
    close,
    atr: 2,
    zoneAgeBars: 5,
    topShadow: 1,
    bottomShadow: 2,
    candleBody: 1,
    wickBodyRatio: 2,
    wickDominanceRatio: 2,
    retestPenetrationPct: 20,
    reactionCloseDistancePct: 2,
    reactionBodyAligned: true,
  };
};

const makeRuntimeState = (
  signal: LiquidityTailsSignal | null,
): LiquidityTailsRuntimeState => ({
  signal,
  zones: signal ? [signal.zone] : [],
});

const mockRuntimeStates = (states: LiquidityTailsRuntimeState[]) => {
  let index = 0;
  mockedCreateLiquidityTailsEngine.mockReturnValue({
    next: jest.fn(() => states[Math.min(index++, states.length - 1)]),
    getState: jest.fn(() => states[Math.min(index, states.length - 1)]),
  } as any);
};

const makeStrategyApi = ({
  getPosition,
  getDecision,
}: {
  getPosition: () => any;
  getDecision: () => { timestamp: number; currentPrice: number };
}) => ({
  skip: (code: string) => ({ kind: 'skip', code }),
  entry: jest.fn(async (params: any) => ({
    kind: 'entry',
    code: params.code,
    orderPlan: params.orderPlan,
    signal: {
      strategy: 'LiquidityTails',
      direction: params.direction,
      additionalIndicators: params.additionalIndicators,
      figures: params.figures,
    },
  })),
  exit: jest.fn(async (params: any) => ({
    kind: 'exit',
    code: params.code,
    closePlan: { direction: params.direction },
  })),
  getCurrentPosition: jest.fn(async () => getPosition()),
  getDecisionPriceContext: jest.fn(async () => getDecision()),
  createLastTradeController: jest.fn(() => ({
    isInCooldown: jest.fn(() => false),
    markTrade: jest.fn(),
  })),
  createStateController: createTestStateController(),
});

const makeCoreConfig = (overrides: Partial<LiquidityTailsConfig> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    MAX_LOSS_VALUE: 10,
    FEE_PERCENT: 0,
    LIQUIDITY_TAILS_STOP_ATR_BUFFER_MULT: 0,
    LIQUIDITY_TAILS_STOP_BUFFER_PCT: 0,
    LIQUIDITY_TAILS_TARGET_R_MULT: 1.6,
    LIQUIDITY_TAILS_SCALE_IN_ENABLED: true,
    LIQUIDITY_TAILS_INITIAL_RISK_FRACTION: 0.7,
    LONG: { ...DEFAULT_CONFIG.LONG, minRiskRatio: 1 },
    SHORT: { ...DEFAULT_CONFIG.SHORT, minRiskRatio: 1 },
    ...overrides,
  }) as LiquidityTailsConfig;

describe('LiquidityTails core scale-in cycle', () => {
  beforeEach(() => {
    mockedCreateLiquidityTailsEngine.mockReset();
  });

  it('uses 70% risk for open and the remaining budget for one improved-price increase', async () => {
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 1, close: 100 })),
      makeRuntimeState(makeSignal({ timestamp: 2, close: 95 })),
      makeRuntimeState(makeSignal({ timestamp: 3, close: 94 })),
    ]);
    let decision = { timestamp: 1, currentPrice: 100 };
    let position: any = null;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getDecision: () => decision,
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig(),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    expect(opened.kind).toBe('entry');
    expect(opened.orderPlan.positionIntent).toBeUndefined();
    expect(opened.orderPlan.qty).toBeCloseTo(0.7);
    expect(opened.signal.additionalIndicators.liquidityTailsContext).toEqual(
      expect.objectContaining({
        action: 'open',
        level: 1,
        levelsFilled: 0,
        riskBudgetUsedPct: 70,
        initialRiskFraction: 0.7,
      }),
    );

    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 116,
    };
    decision = { timestamp: 2, currentPrice: 95 };
    const increased = (await core(makeCandle(2, 95) as any, {} as any)) as any;

    expect(increased.kind).toBe('entry');
    expect(increased.code).toBe('LIQUIDITY_TAILS_BUY_PRESSURE_SCALE_IN');
    expect(increased.orderPlan.positionIntent).toBe('increase');
    expect(increased.orderPlan.qty).toBeCloseTo(0.6);
    expect(increased.orderPlan.stopLossPrice).toBe(90);
    const increaseContext =
      increased.signal.additionalIndicators.liquidityTailsContext;
    expect(increaseContext).toEqual(
      expect.objectContaining({
        action: 'increase',
        level: 2,
        levelsFilled: 1,
        positionQty: 0.7,
      }),
    );
    expect(increaseContext.projectedQty).toBeCloseTo(1.3);
    expect(increaseContext.riskBudgetUsedPct).toBeCloseTo(100);

    position = {
      ...position,
      price:
        (position.price * position.qty +
          decision.currentPrice * increased.orderPlan.qty) /
        (position.qty + increased.orderPlan.qty),
      qty: position.qty + increased.orderPlan.qty,
      tpPrice: increased.orderPlan.takeProfits[0].price,
    };
    decision = { timestamp: 3, currentPrice: 94 };
    const third = (await core(makeCandle(3, 94) as any, {} as any)) as any;

    expect(third).toEqual(
      expect.objectContaining({
        kind: 'skip',
        code: 'LIQUIDITY_TAILS_SCALE_IN_COMPLETE',
      }),
    );
  });

  it('recovers a 70% initial basket after restart and can place the same second level', async () => {
    const position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 0.7,
      slPrice: 90,
      tpPrice: 116,
    };
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 2, close: 95 })),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getDecision: () => ({ timestamp: 2, currentPrice: 95 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig(),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const increased = (await core(makeCandle(2, 95) as any, {} as any)) as any;

    expect(increased).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'LIQUIDITY_TAILS_BUY_PRESSURE_SCALE_IN',
      }),
    );
    expect(increased.orderPlan.qty).toBeCloseTo(0.6);
  });

  it('keeps the current full-risk single-entry behavior when scale-in is disabled', async () => {
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 1, close: 100 })),
      makeRuntimeState(makeSignal({ timestamp: 2, close: 95 })),
    ]);
    let decision = { timestamp: 1, currentPrice: 100 };
    let position: any = null;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getDecision: () => decision,
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_SCALE_IN_ENABLED: false,
      }),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    expect(opened.orderPlan.qty).toBeCloseTo(1);

    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 116,
    };
    decision = { timestamp: 2, currentPrice: 95 };
    const next = (await core(makeCandle(2, 95) as any, {} as any)) as any;

    expect(next).toEqual(
      expect.objectContaining({ kind: 'skip', code: 'POSITION_EXISTS' }),
    );
  });

  it('does not increase at a worse average price', async () => {
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 2, close: 101 })),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => ({
        symbol: 'TESTUSDT',
        direction: 'LONG',
        price: 100,
        qty: 0.7,
        slPrice: 90,
        tpPrice: 116,
      }),
      getDecision: () => ({ timestamp: 2, currentPrice: 101 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig(),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const result = (await core(makeCandle(2, 101) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'skip',
        code: 'LIQUIDITY_TAILS_SCALE_IN_PRICE_NOT_IMPROVED',
      }),
    );
  });

  it('does not use an opposite signal as an increase when opposite exit is disabled', async () => {
    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({ timestamp: 2, close: 105, direction: 'SHORT' }),
      ),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => ({
        symbol: 'TESTUSDT',
        direction: 'LONG',
        price: 110,
        qty: 0.7,
        slPrice: 100,
        tpPrice: 126,
      }),
      getDecision: () => ({ timestamp: 2, currentPrice: 105 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_EXIT_ON_OPPOSITE_RETEST: false,
      }),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const result = (await core(makeCandle(2, 105) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'skip',
        code: 'LIQUIDITY_TAILS_SCALE_IN_DIRECTION_MISMATCH',
      }),
    );
  });
});
