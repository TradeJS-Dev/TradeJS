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
  regimeDirection = 'LONG',
  volatilityShock = false,
  rangeGeometry = getEmptyGridRangeGeometry(),
}: {
  timestamp: number;
  close: number;
  entryDirection?: 'LONG' | 'SHORT' | null;
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
      tpPrice: 102,
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

  it('refuses a scale-in when the observed position already consumes the loss budget', async () => {
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
        FEE_PERCENT: 0,
      } as unknown as GridConfig,
      data: [],
      strategyApi,
    } as any);

    await core(makeCandle(1, 100) as any, {} as any);
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 100,
      qty: 100,
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
      tpPrice: 102,
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
          takeProfits: [{ rate: 1, price: 98 }],
        }),
      }),
    );
    expect(result.signal.additionalIndicators.gridContext).toEqual(
      expect.objectContaining({
        action: 'open',
        regimeDirection: 'SHORT',
        projectedAveragePrice: 100,
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
      tpPrice: 102,
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
