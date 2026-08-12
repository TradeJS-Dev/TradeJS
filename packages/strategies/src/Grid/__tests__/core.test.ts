/** @jest-environment node */

import { config as DEFAULT_CONFIG, GridConfig } from '../config';
import { createGridCore } from '../core';
import { createGridEngine, GridRuntimeState } from '../engine';
import { getEmptyGridRangeGeometry, GridRangeGeometry } from '../rangeGeometry';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

jest.mock('../engine', () => {
  const actual = jest.requireActual('../engine');
  return { ...actual, createGridEngine: jest.fn() };
});

const mockedCreateGridEngine = createGridEngine as jest.MockedFunction<
  typeof createGridEngine
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

const makeRuntimeState = ({
  timestamp,
  close,
  entryDirection = null,
  entryMode = 'pullback_recovery',
  entryStage,
  setupId = null,
  breakoutLevel = null,
  regimeDirection = 'LONG',
  volatilityShock = false,
  rangeGeometry = getEmptyGridRangeGeometry(),
}: {
  timestamp: number;
  close: number;
  entryDirection?: 'LONG' | 'SHORT' | null;
  entryMode?: 'pullback_recovery' | 'breakout_retest';
  entryStage?: 'pullback_recovery' | 'breakout_retest_held' | null;
  setupId?: string | null;
  breakoutLevel?: number | null;
  regimeDirection?: 'LONG' | 'SHORT' | null;
  volatilityShock?: boolean;
  rangeGeometry?: GridRangeGeometry;
}): GridRuntimeState => ({
  snapshot: {
    timestamp,
    close,
    emaFast: close,
    emaSlow: close - (regimeDirection === 'LONG' ? 1 : -1),
    atr: 2,
    atrPct: 2,
    slowSlopeAtr: regimeDirection === 'SHORT' ? -0.2 : 0.2,
    trendStrengthAtr: 0.5,
    candleRangeAtr: volatilityShock ? 4 : 1,
    recentHigh: close + 5,
    recentLow: close - 5,
    regimeDirection,
    entryDirection,
    entryMode,
    entryStage: entryStage ?? (entryDirection ? 'pullback_recovery' : null),
    setupId,
    breakoutLevel,
    breakoutAgeBars: null,
    breakoutRetestCloseDistanceAtr: null,
    stepDistance: 2,
    stopDistance: 10,
    takeProfitDistance: 2,
    volatilityShock,
    rangeGeometry,
  },
  series: {
    emaFast: [{ timestamp, value: close }],
    emaSlow: [{ timestamp, value: close - 1 }],
  },
});

const makeStrategyApi = (getPosition: () => any) => ({
  skip: (code: string) => ({ kind: 'skip', code }),
  entry: jest.fn(async (params: any) => ({
    kind: 'entry',
    code: params.code,
    entryContext: {
      strategy: 'Grid',
      symbol: 'TESTUSDT',
      interval: '15',
      direction: params.direction,
      timestamp: 1,
      prices: {
        currentPrice: 100,
        takeProfitPrice: params.orderPlan.takeProfits[0].price,
        stopLossPrice: params.orderPlan.stopLossPrice,
        riskRatio: 1,
      },
    },
    orderPlan: params.orderPlan,
    signal: {
      strategy: 'Grid',
      direction: params.direction,
      additionalIndicators: params.additionalIndicators,
      figures: params.figures,
    },
  })),
  exit: jest.fn(async (params: any) => ({
    kind: 'exit',
    code: params.code,
    closePlan: { price: 100, timestamp: 1, direction: params.direction },
  })),
  protect: jest.fn((params: any) => ({
    kind: 'protect',
    code: params.code,
    protectPlan: params.protectPlan,
  })),
  getCurrentIndicatorsContext: jest.fn(() => ({ indicators: {} })),
  getCurrentPosition: jest.fn(async () => getPosition()),
  createStateController: createTestStateController(),
});

const mockRuntimeStates = (states: GridRuntimeState[]) => {
  let index = 0;
  mockedCreateGridEngine.mockReturnValue({
    next: jest.fn(() => states[Math.min(index++, states.length - 1)]),
    getState: jest.fn(() => states[Math.min(index, states.length - 1)]),
  } as any);
};

describe('Grid core', () => {
  beforeEach(() => {
    mockedCreateGridEngine.mockReset();
  });

  it('opens one risk-sized level and marks later entries as position increases', async () => {
    const states = [
      makeRuntimeState({ timestamp: 1, close: 100, entryDirection: 'LONG' }),
      makeRuntimeState({ timestamp: 2, close: 97.5 }),
    ];
    mockedCreateGridEngine.mockReturnValue({
      next: jest.fn(() => states.shift()!),
      getState: jest.fn(() => states[0]),
    } as any);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        MAX_LOSS_VALUE: 10,
        GRID_MAX_LEVELS: 4,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const first = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    expect(first.kind).toBe('entry');
    expect(first.orderPlan.positionIntent).toBeUndefined();
    expect(first.orderPlan.qty).toBeCloseTo(0.25);
    expect(first.orderPlan.stopLossPrice).toBe(90);

    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: first.orderPlan.qty,
      slPrice: 90,
      tpPrice: 102,
    };
    const second = (await core(makeCandle(2, 97.5) as any, {} as any)) as any;
    expect(second.kind).toBe('entry');
    expect(second.code).toBe('GRID_SCALE_IN_2');
    expect(second.orderPlan.positionIntent).toBe('increase');
    expect(second.orderPlan.qty).toBeLessThanOrEqual(first.orderPlan.qty);
    expect(second.orderPlan.stopLossPrice).toBe(90);
    expect(second.signal.additionalIndicators.gridContext.action).toBe(
      'increase',
    );
  });

  it('opens breakout continuation as a one-shot full-risk position by default', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
      entryMode: 'breakout_retest',
      entryStage: 'breakout_retest_held',
      setupId: 'grid-breakout-long-1',
      breakoutLevel: 99,
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_ENTRY_MODE: 'breakout_retest',
        GRID_CONTINUATION_ALLOW_SCALE_IN: false,
        GRID_MAX_LEVELS: 4,
        MAX_LOSS_VALUE: 10,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(makeCandle(1, 100) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'GRID_BREAKOUT_RETEST_ENTRY',
        orderPlan: expect.objectContaining({
          qty: 1,
          stopLossPrice: 90,
          takeProfits: [{ rate: 1, price: 102.5 }],
        }),
      }),
    );
    expect(result.signal.additionalIndicators.gridContext).toEqual(
      expect.objectContaining({
        entryMode: 'breakout_retest',
        entryStage: 'breakout_retest_held',
        setupId: 'grid-breakout-long-1',
        breakoutLevel: 99,
      }),
    );
  });

  it.each([
    {
      direction: 'LONG' as const,
      breakoutLevel: 99,
      expectedStop: 98.8,
      expectedTarget: 101.2,
    },
    {
      direction: 'SHORT' as const,
      breakoutLevel: 101,
      expectedStop: 101.2,
      expectedTarget: 98.8,
    },
  ])(
    'builds a frozen retest-structure plan for $direction continuation',
    async ({ direction, breakoutLevel, expectedStop, expectedTarget }) => {
      const state = makeRuntimeState({
        timestamp: 1,
        close: 100,
        entryDirection: direction,
        entryMode: 'breakout_retest',
        entryStage: 'breakout_retest_held',
        breakoutLevel,
        regimeDirection: direction,
      });
      mockRuntimeStates([state]);
      const strategyApi = makeStrategyApi(() => null);
      const core = await createGridCore({
        config: {
          ...DEFAULT_CONFIG,
          GRID_ENTRY_MODE: 'breakout_retest',
          GRID_CONTINUATION_RISK_MODE: 'retest_structure',
          GRID_CONTINUATION_STOP_BUFFER_ATR: 0.1,
          GRID_CONTINUATION_MIN_STOP_DISTANCE_ATR: 0.35,
          GRID_CONTINUATION_TARGET_R: 1,
          FEE_PERCENT: 0,
          MAX_LOSS_VALUE: 10,
        } as unknown as GridConfig,
        data: [],
        strategyApi,
      } as any);

      const result = (await core(makeCandle(1, 100) as any, {} as any)) as any;

      expect(result).toEqual(
        expect.objectContaining({
          kind: 'entry',
          code: 'GRID_BREAKOUT_RETEST_ENTRY',
          orderPlan: expect.objectContaining({
            stopLossPrice: expectedStop,
            takeProfits: [{ rate: 1, price: expectedTarget }],
          }),
        }),
      );
      expect(result.orderPlan.qty).toBeCloseTo(
        10 / Math.abs(100 - expectedStop),
      );
      expect(result.signal.additionalIndicators.gridContext).toEqual(
        expect.objectContaining({
          stopLossPrice: expectedStop,
          takeProfitPrice: expectedTarget,
          grossRiskRatio: 1,
        }),
      );
    },
  );

  it('clamps a continuation stop to the configured minimum ATR distance', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
      entryMode: 'breakout_retest',
      entryStage: 'breakout_retest_held',
      breakoutLevel: 99.9,
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_ENTRY_MODE: 'breakout_retest',
        GRID_CONTINUATION_RISK_MODE: 'retest_structure',
        GRID_CONTINUATION_STOP_BUFFER_ATR: 0,
        GRID_CONTINUATION_MIN_STOP_DISTANCE_ATR: 0.35,
        GRID_CONTINUATION_TARGET_R: 1.25,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(makeCandle(1, 100) as any, {} as any)) as any;

    expect(result.orderPlan.stopLossPrice).toBeCloseTo(99.3);
    expect(result.orderPlan.takeProfits[0].price).toBeCloseTo(100.875);
  });

  it('keeps continuation protection immutable when later ATR and step change', async () => {
    const openState = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
      entryMode: 'breakout_retest',
      entryStage: 'breakout_retest_held',
      breakoutLevel: 99,
    });
    const laterState = makeRuntimeState({
      timestamp: 2,
      close: 100,
      entryMode: 'breakout_retest',
    });
    laterState.snapshot!.atr = 20;
    laterState.snapshot!.stepDistance = 50;
    mockRuntimeStates([openState, laterState]);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_ENTRY_MODE: 'breakout_retest',
        GRID_CONTINUATION_RISK_MODE: 'retest_structure',
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
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

    await expect(core(makeCandle(2, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_WAIT_NEXT_LEVEL',
    });
    expect(strategyApi.protect).not.toHaveBeenCalled();
  });

  it('keeps the initial structural target when continuation scale-in is enabled', async () => {
    const openState = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
      entryMode: 'breakout_retest',
      entryStage: 'breakout_retest_held',
      breakoutLevel: 90,
    });
    const increaseState = makeRuntimeState({
      timestamp: 2,
      close: 97.5,
      entryMode: 'breakout_retest',
    });
    mockRuntimeStates([openState, increaseState]);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_ENTRY_MODE: 'breakout_retest',
        GRID_CONTINUATION_RISK_MODE: 'retest_structure',
        GRID_CONTINUATION_ALLOW_SCALE_IN: true,
        GRID_MAX_LEVELS: 4,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
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
    const increased = (await core(
      makeCandle(2, 97.5) as any,
      {} as any,
    )) as any;

    expect(increased).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'GRID_SCALE_IN_2',
        orderPlan: expect.objectContaining({
          positionIntent: 'increase',
          stopLossPrice: opened.orderPlan.stopLossPrice,
          takeProfits: opened.orderPlan.takeProfits,
        }),
      }),
    );
  });

  it('recovers frozen continuation protection from exchange position prices', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryMode: 'breakout_retest',
    });
    state.snapshot!.atr = 20;
    state.snapshot!.stepDistance = 50;
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => ({
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 1,
      slPrice: 98,
      tpPrice: 104,
    }));
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_ENTRY_MODE: 'breakout_retest',
        GRID_CONTINUATION_RISK_MODE: 'retest_structure',
        GRID_EXIT_ON_REGIME_FLIP: false,
        GRID_EXIT_ON_VOLATILITY_SHOCK: false,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_WAIT_NEXT_LEVEL',
    });
    expect(strategyApi.protect).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing breakout geometry',
      mutate: () => undefined,
      config: {},
      expectedCode: 'GRID_INVALID_CONTINUATION_GEOMETRY',
    },
    {
      name: 'non-positive net reward after costs',
      mutate: (state: GridRuntimeState) => {
        state.snapshot!.breakoutLevel = 99;
      },
      config: {
        GRID_CONTINUATION_TARGET_R: 0.01,
        FEE_PERCENT: 0.01,
      },
      expectedCode: 'GRID_INVALID_CONTINUATION_ECONOMICS',
    },
  ])('rejects $name', async ({ mutate, config, expectedCode }) => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
      entryMode: 'breakout_retest',
      entryStage: 'breakout_retest_held',
    });
    mutate(state);
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_ENTRY_MODE: 'breakout_retest',
        GRID_CONTINUATION_RISK_MODE: 'retest_structure',
        ...config,
      } as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: expectedCode,
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it('rebuilds the same next grid level from the exchange basket after restart', async () => {
    mockedCreateGridEngine.mockImplementation(
      () =>
        ({
          next: jest.fn((candle) =>
            makeRuntimeState({
              timestamp: candle.timestamp,
              close: candle.close,
              entryDirection: candle.timestamp === 1 ? 'LONG' : null,
            }),
          ),
          getState: jest.fn(),
        }) as any,
    );
    const config = {
      ...DEFAULT_CONFIG,
      MAX_LOSS_VALUE: 10,
      GRID_MAX_LEVELS: 4,
      FEE_PERCENT: 0,
    } as unknown as GridConfig;
    let position: any = null;
    const continuousApi = makeStrategyApi(() => position);
    const continuousCore = await createGridCore({
      config,
      data: [],
      strategyApi: continuousApi,
    } as any);

    const opened = (await continuousCore(
      makeCandle(1, 100) as any,
      {} as any,
    )) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 102.5,
    };
    const increased = (await continuousCore(
      makeCandle(2, 97.5) as any,
      {} as any,
    )) as any;
    position = {
      ...position,
      price:
        (position.price * position.qty + 97.5 * increased.orderPlan.qty) /
        (position.qty + increased.orderPlan.qty),
      qty: position.qty + increased.orderPlan.qty,
      tpPrice: increased.orderPlan.takeProfits[0].price,
    };

    const continuousNext = (await continuousCore(
      makeCandle(3, 96.5) as any,
      {} as any,
    )) as any;
    const restartedApi = makeStrategyApi(() => position);
    const restartedCore = await createGridCore({
      config,
      data: [],
      strategyApi: restartedApi,
    } as any);
    const restartedNext = (await restartedCore(
      makeCandle(3, 96.5) as any,
      {} as any,
    )) as any;

    expect(continuousNext).toEqual(
      expect.objectContaining({ kind: 'entry', code: 'GRID_SCALE_IN_3' }),
    );
    expect(restartedNext).toEqual(
      expect.objectContaining({ kind: 'entry', code: 'GRID_SCALE_IN_3' }),
    );
    expect(restartedNext.orderPlan).toEqual(continuousNext.orderPlan);
    expect(restartedNext.signal.additionalIndicators.gridContext).toEqual(
      continuousNext.signal.additionalIndicators.gridContext,
    );
  });

  it('exits an open grid when the causal trend regime flips', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      regimeDirection: 'SHORT',
    });
    mockedCreateGridEngine.mockReturnValue({
      next: jest.fn(() => state),
      getState: jest.fn(() => state),
    } as any);
    const strategyApi = makeStrategyApi(() => ({
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 101,
      qty: 1,
      slPrice: 91,
      tpPrice: 103,
    }));
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'GRID_REGIME_FLIP_EXIT',
      }),
    );
  });

  it('refreshes missing basket protection without adding another level', async () => {
    const state = makeRuntimeState({ timestamp: 1, close: 100 });
    mockedCreateGridEngine.mockReturnValue({
      next: jest.fn(() => state),
      getState: jest.fn(() => state),
    } as any);
    const strategyApi = makeStrategyApi(() => ({
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 1,
      slPrice: 90,
    }));
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'protect',
        code: 'GRID_REFRESH_BASKET_PROTECTION',
      }),
    );
  });

  it('returns warmup until the detector has a snapshot', async () => {
    const state: GridRuntimeState = {
      snapshot: null,
      series: { emaFast: [], emaSlow: [] },
    };
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_WARMUP',
    });
    expect(strategyApi.getCurrentPosition).not.toHaveBeenCalled();
  });

  it.each([
    { direction: 'LONG' as const, close: 89, stopLossPrice: 90 },
    { direction: 'SHORT' as const, close: 111, stopLossPrice: 110 },
  ])(
    'exits a $direction position when its immutable hard stop is breached',
    async ({ direction, close, stopLossPrice }) => {
      const state = makeRuntimeState({
        timestamp: 1,
        close,
        regimeDirection: direction,
      });
      mockRuntimeStates([state]);
      const strategyApi = makeStrategyApi(() => ({
        symbol: 'TESTUSDT',
        direction,
        price: 100,
        qty: 1,
        slPrice: stopLossPrice,
        tpPrice: direction === 'LONG' ? 102 : 98,
      }));
      const core = await createGridCore({
        config: DEFAULT_CONFIG as GridConfig,
        data: [],
        strategyApi,
      } as any);

      await expect(
        core(makeCandle(1, close) as any, {} as any),
      ).resolves.toEqual(
        expect.objectContaining({
          kind: 'exit',
          code: 'GRID_HARD_STOP_EXIT',
        }),
      );
    },
  );

  it('exits an open cycle on a volatility shock', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      regimeDirection: 'LONG',
      volatilityShock: true,
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => ({
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 1,
      slPrice: 90,
      tpPrice: 102,
    }));
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'GRID_VOLATILITY_SHOCK_EXIT',
      }),
    );
  });

  it('does not emit a duplicate scale-in on the same candle', async () => {
    const openState = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
    });
    const increaseState = makeRuntimeState({ timestamp: 2, close: 97.5 });
    mockRuntimeStates([openState, increaseState]);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        MAX_LOSS_VALUE: 10,
        GRID_MAX_LEVELS: 4,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 102.5,
    };
    await expect(core(makeCandle(2, 97.5) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({ kind: 'entry', code: 'GRID_SCALE_IN_2' }),
    );
    await expect(core(makeCandle(2, 97.5) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_ORDER_PENDING',
    });
    expect(strategyApi.entry).toHaveBeenCalledTimes(2);
  });

  it('keeps the initial order pending when the position is not visible on the same candle', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({ kind: 'entry' }),
    );
    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_ORDER_PENDING',
    });
    expect(strategyApi.entry).toHaveBeenCalledTimes(1);
  });

  it('clears an unconfirmed scale-in and retries its level on a later candle', async () => {
    const states = [
      makeRuntimeState({ timestamp: 1, close: 100, entryDirection: 'LONG' }),
      makeRuntimeState({ timestamp: 2, close: 97.5 }),
      makeRuntimeState({ timestamp: 3, close: 95 }),
    ];
    mockRuntimeStates(states);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        MAX_LOSS_VALUE: 10,
        GRID_MAX_LEVELS: 4,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 102,
    };
    await expect(core(makeCandle(2, 97.5) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({ kind: 'entry', code: 'GRID_SCALE_IN_2' }),
    );
    await expect(core(makeCandle(3, 95) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({ kind: 'entry', code: 'GRID_SCALE_IN_2' }),
    );
    expect(strategyApi.entry).toHaveBeenCalledTimes(3);
  });

  it('counts paid entry fees when the observed position consumes the loss budget', async () => {
    const openState = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
    });
    const adverseState = makeRuntimeState({ timestamp: 2, close: 97.5 });
    mockRuntimeStates([openState, adverseState]);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        MAX_LOSS_VALUE: 10,
        GRID_MAX_LEVELS: 4,
        FEE_PERCENT: 0.01,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await core(makeCandle(1, 100) as any, {} as any);
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 0.85,
      slPrice: 90,
      tpPrice: 102,
    };

    await expect(core(makeCandle(2, 97.5) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_RISK_BUDGET_EXHAUSTED',
    });
    expect(strategyApi.entry).toHaveBeenCalledTimes(1);
  });

  it('starts cooldown after a confirmed cycle disappears', async () => {
    const states = [
      makeRuntimeState({ timestamp: 1, close: 100, entryDirection: 'LONG' }),
      makeRuntimeState({ timestamp: 900_001, close: 100 }),
      makeRuntimeState({
        timestamp: 1_800_001,
        close: 100,
        entryDirection: 'LONG',
      }),
    ];
    mockRuntimeStates(states);
    let position: any = null;
    const strategyApi = makeStrategyApi(() => position);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        FEE_PERCENT: 0,
        GRID_ENTRY_COOLDOWN_BARS: 8,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const opened = (await core(makeCandle(1, 100) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: opened.orderPlan.qty,
      slPrice: 90,
      tpPrice: 102.5,
    };
    await expect(
      core(makeCandle(900_001, 100) as any, {} as any),
    ).resolves.toEqual({ kind: 'skip', code: 'GRID_WAIT_NEXT_LEVEL' });
    position = null;
    await expect(
      core(makeCandle(1_800_001, 100) as any, {} as any),
    ).resolves.toEqual({ kind: 'skip', code: 'GRID_ENTRY_COOLDOWN' });
  });

  it('recovers a short cycle with an invalid reported stop and refreshes protection', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      regimeDirection: 'SHORT',
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => ({
      symbol: 'TESTUSDT',
      direction: 'SHORT',
      price: 100,
      qty: 1,
      slPrice: 90,
      tpPrice: 98,
    }));
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'protect',
        code: 'GRID_REFRESH_BASKET_PROTECTION',
        protectPlan: expect.objectContaining({
          direction: 'SHORT',
          stopLossPrice: 110,
        }),
      }),
    );
  });

  it('builds directional stop, target and context for a short entry', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'SHORT',
      regimeDirection: 'SHORT',
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        MAX_LOSS_VALUE: 10,
        GRID_MAX_LEVELS: 4,
        GRID_TAKE_PROFIT_STEP_MULT_SHORT: 1.1,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(makeCandle(1, 100) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        orderPlan: expect.objectContaining({
          qty: 0.25,
          stopLossPrice: 110,
          takeProfits: [{ rate: 1, price: 97.8 }],
        }),
      }),
    );
    expect(result.signal.additionalIndicators.gridContext).toEqual(
      expect.objectContaining({
        action: 'open',
        regimeDirection: 'SHORT',
        projectedAveragePrice: 100,
        takeProfitDistance: 2.2,
      }),
    );
  });

  it('rejects a corrupted detector snapshot that cannot produce a finite order size', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
    });
    state.snapshot!.stopDistance = Number.NaN;
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: DEFAULT_CONFIG as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_INVALID_QTY',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'block_entries', position: 0.2 },
    { mode: 'block_all', position: 0.2 },
    { mode: 'edge_all', position: 0.8 },
  ])(
    'blocks a long entry in detected range for $mode at position $position',
    async ({ mode, position }) => {
      const state = makeRuntimeState({
        timestamp: 1,
        close: 100,
        entryDirection: 'LONG',
        rangeGeometry: {
          ...getEmptyGridRangeGeometry(),
          ready: true,
          detected: true,
          position,
        },
      });
      mockRuntimeStates([state]);
      const strategyApi = makeStrategyApi(() => null);
      const core = await createGridCore({
        config: {
          ...DEFAULT_CONFIG,
          GRID_RANGE_FILTER_MODE: mode,
        } as GridConfig,
        data: [],
        strategyApi,
      } as any);

      await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
        {
          kind: 'skip',
          code: 'GRID_RANGE_ENTRY_BLOCKED',
        },
      );
      expect(strategyApi.entry).not.toHaveBeenCalled();
    },
  );

  it('allows an edge-mode long entry near the detected lower boundary', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 100,
      entryDirection: 'LONG',
      rangeGeometry: {
        ...getEmptyGridRangeGeometry(),
        ready: true,
        detected: true,
        position: 0.2,
      },
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_RANGE_FILTER_MODE: 'edge_all',
      } as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({ kind: 'entry' }),
    );
  });

  it('blocks an adverse scale-in when the whole detected range is guarded', async () => {
    const state = makeRuntimeState({
      timestamp: 1,
      close: 97.5,
      rangeGeometry: {
        ...getEmptyGridRangeGeometry(),
        ready: true,
        detected: true,
        position: 0.2,
      },
    });
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => ({
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 0.25,
      slPrice: 90,
      tpPrice: 102.5,
    }));
    const core = await createGridCore({
      config: {
        ...DEFAULT_CONFIG,
        GRID_RANGE_FILTER_MODE: 'block_all',
        GRID_MAX_LEVELS: 4,
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 97.5) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRID_RANGE_SCALE_IN_BLOCKED',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing pullback',
      state: makeRuntimeState({ timestamp: 1, close: 100 }),
      config: DEFAULT_CONFIG,
      code: 'GRID_NO_DIRECTIONAL_PULLBACK',
    },
    {
      name: 'disabled short side',
      state: makeRuntimeState({
        timestamp: 1,
        close: 100,
        entryDirection: 'SHORT',
        regimeDirection: 'SHORT',
      }),
      config: {
        ...DEFAULT_CONFIG,
        SHORT: { ...DEFAULT_CONFIG.SHORT, enable: false },
      },
      code: 'STRATEGY_DISABLED',
    },
    {
      name: 'zero loss budget',
      state: makeRuntimeState({
        timestamp: 1,
        close: 100,
        entryDirection: 'LONG',
      }),
      config: { ...DEFAULT_CONFIG, MAX_LOSS_VALUE: 0 },
      code: 'GRID_INVALID_MAX_LOSS_VALUE',
    },
  ])('skips entry for $name', async ({ state, config, code }) => {
    mockRuntimeStates([state]);
    const strategyApi = makeStrategyApi(() => null);
    const core = await createGridCore({
      config: config as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(makeCandle(1, 100) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code,
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });
});
