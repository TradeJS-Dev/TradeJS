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
  candidateAction = 'initial_entry',
}: {
  timestamp: number;
  close: number;
  direction?: 'LONG' | 'SHORT';
  zoneId?: string;
  candidateAction?: 'initial_entry' | 'scale_in';
}): LiquidityTailsSignal => {
  const isLong = direction === 'LONG';
  const top = isLong ? 95 : 110;
  const bottom = isLong ? 90 : 105;

  return {
    setupId: zoneId,
    candidateAction,
    candidateOrdinal: candidateAction === 'initial_entry' ? 1 : 2,
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
      retestsObserved: candidateAction === 'initial_entry' ? 1 : 2,
      candidatesEmitted: candidateAction === 'initial_entry' ? 1 : 2,
      entryCandidatesEmitted: 1,
      scaleInCandidatesEmitted: candidateAction === 'scale_in' ? 1 : 0,
      signalsEmitted: candidateAction === 'initial_entry' ? 1 : 2,
      lastRetestIndex: 1,
      lastSignalIndex: 1,
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
    rejectionEfficiencyRatio: 1,
    reactionBodyAligned: true,
    retestOrdinal: candidateAction === 'initial_entry' ? 1 : 2,
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
    LIQUIDITY_TAILS_SCALE_IN_COUNT: 1,
    LIQUIDITY_TAILS_INITIAL_RISK_FRACTION: 0.7,
    LIQUIDITY_TAILS_SCALE_IN_MIN_IMPROVEMENT_ATR: 1,
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
      makeRuntimeState(
        makeSignal({ timestamp: 1, close: 100, zoneId: 'zone-cycle' }),
      ),
      makeRuntimeState(
        makeSignal({
          timestamp: 2,
          close: 95,
          zoneId: 'zone-cycle',
          candidateAction: 'scale_in',
        }),
      ),
      makeRuntimeState(
        makeSignal({
          timestamp: 3,
          close: 94,
          zoneId: 'zone-cycle',
          candidateAction: 'scale_in',
        }),
      ),
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
        positionAveragePrice: null,
        priceImprovementAtr: null,
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
        positionAveragePrice: 100,
        priceImprovementAtr: 2.5,
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

  it('splits the remaining risk budget across three improved-price increases', async () => {
    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({ timestamp: 1, close: 100, zoneId: 'zone-cycle' }),
      ),
      ...[95, 94, 93, 92].map((close, index) =>
        makeRuntimeState(
          makeSignal({
            timestamp: index + 2,
            close,
            zoneId: 'zone-cycle',
            candidateAction: 'scale_in',
          }),
        ),
      ),
    ]);
    let decision = { timestamp: 1, currentPrice: 100 };
    let position: any = null;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getDecision: () => decision,
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_SCALE_IN_COUNT: 3,
        LIQUIDITY_TAILS_INITIAL_RISK_FRACTION: 0.4,
      }),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    expect(opened.orderPlan.qty).toBeCloseTo(0.4);
    expect(
      opened.signal.additionalIndicators.liquidityTailsContext,
    ).toMatchObject({
      level: 1,
      maxLevels: 4,
      targetRiskBudgetPct: 40,
      riskBudgetUsedPct: 40,
    });
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 116,
    };

    const expectedRiskBudgetPct = [60, 80, 100];
    for (let index = 0; index < expectedRiskBudgetPct.length; index += 1) {
      decision = {
        timestamp: index + 2,
        currentPrice: [95, 94, 93][index],
      };
      const increased = (await core(
        makeCandle(decision.timestamp, decision.currentPrice) as any,
        {} as any,
      )) as any;
      const context =
        increased.signal.additionalIndicators.liquidityTailsContext;

      expect(increased.kind).toBe('entry');
      expect(increased.orderPlan.positionIntent).toBe('increase');
      expect(context).toMatchObject({
        action: 'increase',
        level: index + 2,
        levelsFilled: index + 1,
        maxLevels: 4,
        targetRiskBudgetPct: expectedRiskBudgetPct[index],
      });
      expect(context.projectedRiskValue).toBeCloseTo(
        expectedRiskBudgetPct[index] / 10,
      );

      position = {
        ...position,
        price: context.projectedAveragePrice,
        qty: context.projectedQty,
        tpPrice: increased.orderPlan.takeProfits[0].price,
      };
    }

    decision = { timestamp: 5, currentPrice: 92 };
    const complete = (await core(makeCandle(5, 92) as any, {} as any)) as any;
    expect(complete).toEqual(
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
      makeRuntimeState(
        makeSignal({
          timestamp: 2,
          close: 95,
          candidateAction: 'scale_in',
        }),
      ),
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

  it('recovers the third of four levels after restart', async () => {
    const position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 96,
      qty: 8 / 6,
      slPrice: 90,
      tpPrice: 105.6,
    };
    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({
          timestamp: 4,
          close: 93,
          candidateAction: 'scale_in',
        }),
      ),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getDecision: () => ({ timestamp: 4, currentPrice: 93 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_SCALE_IN_COUNT: 3,
        LIQUIDITY_TAILS_INITIAL_RISK_FRACTION: 0.4,
      }),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const increased = (await core(makeCandle(4, 93) as any, {} as any)) as any;
    const context = increased.signal.additionalIndicators.liquidityTailsContext;

    expect(increased).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'LIQUIDITY_TAILS_BUY_PRESSURE_SCALE_IN',
      }),
    );
    expect(context).toMatchObject({
      level: 4,
      levelsFilled: 3,
      maxLevels: 4,
      targetRiskBudgetPct: 100,
    });
    expect(context.projectedRiskValue).toBeCloseTo(10);
  });

  it('keeps a 70% initial risk allocation when scale-in is disabled', async () => {
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
    expect(opened.orderPlan.qty).toBeCloseTo(0.7);

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

  it('uses the same fee-aware sizing for a full-risk single entry', async () => {
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 1, close: 100 })),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getDecision: () => ({ timestamp: 1, currentPrice: 100 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        FEE_PERCENT: 0.001,
        LIQUIDITY_TAILS_SCALE_IN_ENABLED: false,
        LIQUIDITY_TAILS_INITIAL_RISK_FRACTION: 1,
      }),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;

    expect(opened.orderPlan.qty).toBeCloseTo(10 / (10 + 0.1 + 0.09));
    expect(
      opened.signal.additionalIndicators.liquidityTailsContext
        .projectedRiskValue,
    ).toBeCloseTo(10);
  });

  it('uses directional target R and falls back to the shared target', async () => {
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 1, close: 100 })),
    ]);
    const longStrategyApi = makeStrategyApi({
      getPosition: () => null,
      getDecision: () => ({ timestamp: 1, currentPrice: 100 }),
    });
    const longCore = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_SCALE_IN_ENABLED: false,
        LIQUIDITY_TAILS_TARGET_R_MULT_LONG: 2,
      }),
      data: [],
      strategyApi: longStrategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const longEntry = (await longCore(
      makeCandle(1, 100) as any,
      {} as any,
    )) as any;

    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({ timestamp: 2, close: 100, direction: 'SHORT' }),
      ),
    ]);
    const shortStrategyApi = makeStrategyApi({
      getPosition: () => null,
      getDecision: () => ({ timestamp: 2, currentPrice: 100 }),
    });
    const shortCore = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_SCALE_IN_ENABLED: false,
        LIQUIDITY_TAILS_TARGET_R_MULT_LONG: 2,
      }),
      data: [],
      strategyApi: shortStrategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const shortEntry = (await shortCore(
      makeCandle(2, 100) as any,
      {} as any,
    )) as any;

    expect(longEntry.orderPlan.takeProfits[0].price).toBe(120);
    expect(shortEntry.orderPlan.takeProfits[0].price).toBe(84);
  });

  it('requires at least the configured ATR improvement for scale-in', async () => {
    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({
          timestamp: 2,
          close: 98.1,
          candidateAction: 'scale_in',
        }),
      ),
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
      getDecision: () => ({ timestamp: 2, currentPrice: 98.1 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig(),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const result = (await core(makeCandle(2, 98.1) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'skip',
        code: 'LIQUIDITY_TAILS_SCALE_IN_MIN_IMPROVEMENT_NOT_MET',
      }),
    );
  });

  it('allows scale-in at exactly the configured ATR improvement', async () => {
    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({
          timestamp: 2,
          close: 98,
          candidateAction: 'scale_in',
        }),
      ),
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
      getDecision: () => ({ timestamp: 2, currentPrice: 98 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig(),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const result = (await core(makeCandle(2, 98) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'LIQUIDITY_TAILS_BUY_PRESSURE_SCALE_IN',
      }),
    );
  });

  it('exits instead of increasing on a qualifying follow-up retest', async () => {
    const signal = makeSignal({
      timestamp: 2,
      close: 98,
      candidateAction: 'scale_in',
    });
    signal.retestOrdinal = 2;
    mockRuntimeStates([makeRuntimeState(signal)]);
    const strategyApi = makeStrategyApi({
      getPosition: () => ({
        symbol: 'TESTUSDT',
        direction: 'LONG',
        price: 100,
        qty: 0.7,
        slPrice: 90,
        tpPrice: 116,
      }),
      getDecision: () => ({ timestamp: 2, currentPrice: 98 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_EXIT_ON_SCALE_IN_RETEST: true,
        LIQUIDITY_TAILS_SCALE_IN_ENABLED: false,
      }),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const result = (await core(makeCandle(2, 98) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'LIQUIDITY_TAILS_SCALE_IN_RETEST_EXIT',
      }),
    );
  });

  it('does not use a secondary zone retest as a new primary entry', async () => {
    const signal = makeSignal({
      timestamp: 2,
      close: 98,
      candidateAction: 'scale_in',
    });
    signal.retestOrdinal = 2;
    mockRuntimeStates([makeRuntimeState(signal)]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getDecision: () => ({ timestamp: 2, currentPrice: 98 }),
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig(),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const result = (await core(makeCandle(2, 98) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'skip',
        code: 'LIQUIDITY_TAILS_SCALE_IN_RETEST_WITHOUT_POSITION',
      }),
    );
  });

  it('exits after the original zone is invalidated before the buffered stop', async () => {
    mockRuntimeStates([
      makeRuntimeState(makeSignal({ timestamp: 1, close: 100 })),
      makeRuntimeState(null),
    ]);
    let position: any = null;
    let decision = { timestamp: 1, currentPrice: 100 };
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getDecision: () => decision,
    });
    const core = await createLiquidityTailsCore({
      config: makeCoreConfig({
        LIQUIDITY_TAILS_EXIT_ON_INVALIDATION: false,
        LIQUIDITY_TAILS_EXIT_ON_INVALIDATION_LONG: true,
        LIQUIDITY_TAILS_STOP_ATR_BUFFER_MULT: 1,
      } as unknown as Partial<LiquidityTailsConfig>),
      data: [],
      strategyApi,
      indicatorsState: { snapshot: jest.fn(() => ({})) },
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: opened.orderPlan.stopLossPrice,
      tpPrice: opened.orderPlan.takeProfits[0].price,
    };
    decision = { timestamp: 2, currentPrice: 89.5 };

    const result = (await core(makeCandle(2, 89.5) as any, {} as any)) as any;

    expect(opened.orderPlan.stopLossPrice).toBe(88);
    expect(result).toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'LIQUIDITY_TAILS_INVALIDATION_EXIT',
      }),
    );
  });

  it('does not increase at a worse average price', async () => {
    mockRuntimeStates([
      makeRuntimeState(
        makeSignal({
          timestamp: 2,
          close: 101,
          candidateAction: 'scale_in',
        }),
      ),
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

  it('does not use an opposite signal as an increase by default', async () => {
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
      config: makeCoreConfig(),
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
