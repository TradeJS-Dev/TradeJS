/** @jest-environment node */

import type { Position } from '@tradejs/types';
import { config as DEFAULT_CONFIG, type GridClassicConfig } from '../config';
import { createGridClassicCore } from '../core';
import {
  createGridClassicEngine,
  type GridClassicRuntimeState,
} from '../engine';
import type { CausalRangeGeometry } from '../../shared/causalRangeGeometry';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

jest.mock('../engine', () => {
  const actual = jest.requireActual('../engine');
  return { ...actual, createGridClassicEngine: jest.fn() };
});

const mockedCreateGridClassicEngine =
  createGridClassicEngine as jest.MockedFunction<
    typeof createGridClassicEngine
  >;

const geometry = (
  overrides: Partial<CausalRangeGeometry> = {},
): CausalRangeGeometry => ({
  ready: true,
  detected: true,
  upperPrice: 105,
  lowerPrice: 95,
  centerPrice: 100,
  position: 0.05,
  widthAtr: 10,
  centerSlopeAtrPerBar: 0,
  boundaryDivergenceAtr: 0,
  containmentRatio: 0.9,
  highPivotCount: 3,
  lowPivotCount: 3,
  rangeAgeBars: 48,
  breakoutDirection: null,
  volatilityExpansionRatio: 1,
  volatilityExpansion: false,
  upperLine: {
    startTimestamp: 1,
    startPrice: 105,
    endTimestamp: 10,
    endPrice: 105,
  },
  lowerLine: {
    startTimestamp: 1,
    startPrice: 95,
    endTimestamp: 10,
    endPrice: 95,
  },
  centerLine: {
    startTimestamp: 1,
    startPrice: 100,
    endTimestamp: 10,
    endPrice: 100,
  },
  pivots: [
    { kind: 'high', barIndex: 1, timestamp: 1, price: 105 },
    { kind: 'low', barIndex: 2, timestamp: 2, price: 95 },
  ],
  historySize: 48,
  pivotHistorySize: 6,
  ...overrides,
});

const runtimeState = ({
  timestamp,
  close,
  entryDirection = null,
  rangeGeometry = geometry(),
  volatilityShock = false,
}: {
  timestamp: number;
  close: number;
  entryDirection?: 'LONG' | 'SHORT' | null;
  rangeGeometry?: CausalRangeGeometry;
  volatilityShock?: boolean;
}): GridClassicRuntimeState => ({
  snapshot: {
    timestamp,
    close,
    atr: 1,
    candleRangeAtr: volatilityShock ? 4 : 1,
    volatilityShock,
    geometry: rangeGeometry,
    longRejection: entryDirection === 'LONG',
    shortRejection: entryDirection === 'SHORT',
    longCloseInside: entryDirection === 'LONG',
    shortCloseInside: entryDirection === 'SHORT',
    entryDirection,
  },
  closeSeries: [{ timestamp, value: close }],
});

const candle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const mockStates = (states: GridClassicRuntimeState[]) => {
  let index = 0;
  mockedCreateGridClassicEngine.mockReturnValue({
    next: jest.fn(() => states[Math.min(index++, states.length - 1)]),
    getState: jest.fn(() => states[Math.min(index, states.length - 1)]),
  } as any);
};

const makeStrategyApi = ({
  getPosition,
  getCurrentPrice,
}: {
  getPosition: () => Position | null;
  getCurrentPrice: () => number;
}) => {
  const api = {
    skip: (code: string) => ({ kind: 'skip', code }),
    entry: jest.fn(async (params: any) => ({
      kind: 'entry',
      code: params.code,
      entryContext: {
        strategy: 'GridClassic',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: 1,
        prices: {
          currentPrice: getCurrentPrice(),
          takeProfitPrice: params.orderPlan.takeProfits[0].price,
          stopLossPrice: params.orderPlan.stopLossPrice,
          riskRatio: 1,
        },
      },
      orderPlan: params.orderPlan,
      signal: {
        strategy: 'GridClassic',
        direction: params.direction,
        additionalIndicators: params.additionalIndicators,
        figures: params.figures,
      },
    })),
    exit: jest.fn(async (params: any) => ({
      kind: 'exit',
      code: params.code,
      closePlan: {
        price: getCurrentPrice(),
        timestamp: 1,
        direction: params.direction,
      },
    })),
    protect: jest.fn((params: any) => ({
      kind: 'protect',
      code: params.code,
      protectPlan: params.protectPlan,
    })),
    getCurrentIndicatorsContext: jest.fn(() => ({ indicators: {} })),
    getDecisionPriceContext: jest.fn(async () => ({
      timestamp: 1,
      currentPrice: getCurrentPrice(),
      candle: candle(1, getCurrentPrice()),
    })),
    getCurrentPosition: jest.fn(async () => getPosition()),
    createStateController: createTestStateController(),
  };
  return api;
};

describe('GridClassic core', () => {
  beforeEach(() => {
    mockedCreateGridClassicEngine.mockReset();
  });

  it.each([
    ['LONG', 95.5, 94.9, 'GRIDCLASSIC_LOWER_EDGE_LONG'],
    ['SHORT', 104.5, 105.1, 'GRIDCLASSIC_UPPER_EDGE_SHORT'],
  ] as const)(
    'opens and sequentially adds a non-increasing %s level',
    async (direction, entryPrice, nextPrice, entryCode) => {
      mockStates([
        runtimeState({
          timestamp: 1,
          close: entryPrice,
          entryDirection: direction,
          rangeGeometry: geometry({
            position: direction === 'LONG' ? 0.05 : 0.95,
          }),
        }),
        runtimeState({
          timestamp: 2,
          close: nextPrice,
          rangeGeometry: geometry({
            position: direction === 'LONG' ? 0 : 1,
          }),
        }),
      ]);
      let position: Position | null = null;
      let currentPrice: number = entryPrice;
      const strategyApi = makeStrategyApi({
        getPosition: () => position,
        getCurrentPrice: () => currentPrice,
      });
      const core = await createGridClassicCore({
        config: {
          ...DEFAULT_CONFIG,
          FEE_PERCENT: 0,
          GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        } as GridClassicConfig,
        data: [],
        strategyApi,
      } as any);

      const first = (await core(
        candle(1, entryPrice) as any,
        {} as any,
      )) as any;
      expect(first).toEqual(
        expect.objectContaining({ kind: 'entry', code: entryCode }),
      );
      position = {
        symbol: 'TESTUSDT',
        direction,
        price: entryPrice,
        qty: first.orderPlan.qty,
        slPrice: first.orderPlan.stopLossPrice,
        tpPrice: first.orderPlan.takeProfits[0].price,
      };
      currentPrice = nextPrice;
      const second = (await core(
        candle(2, nextPrice) as any,
        {} as any,
      )) as any;

      expect(second.kind).toBe('entry');
      expect(second.code).toBe('GRIDCLASSIC_SCALE_IN_2');
      expect(second.orderPlan.positionIntent).toBe('increase');
      expect(second.orderPlan.qty).toBeLessThanOrEqual(first.orderPlan.qty);
      expect(second.orderPlan.stopLossPrice).toBe(
        first.orderPlan.stopLossPrice,
      );
    },
  );

  it('allows at most one addition on the same closed candle', async () => {
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
      runtimeState({ timestamp: 2, close: 94.9 }),
    ]);
    let position: Position | null = null;
    let currentPrice = 95.5;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getCurrentPrice: () => currentPrice,
    });
    const core = await createGridClassicCore({
      config: {
        ...DEFAULT_CONFIG,
        FEE_PERCENT: 0,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);
    const first = (await core(candle(1, 95.5) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 95.5,
      qty: first.orderPlan.qty,
      slPrice: first.orderPlan.stopLossPrice,
      tpPrice: first.orderPlan.takeProfits[0].price,
    };
    currentPrice = 94.9;

    const addition = (await core(candle(2, 94.9) as any, {} as any)) as any;
    const duplicate = await core(candle(2, 94.9) as any, {} as any);

    expect(addition.kind).toBe('entry');
    expect(duplicate).toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_ORDER_PENDING',
    });
  });

  it('freezes entry geometry and does not widen its stop after range drift', async () => {
    const driftedGeometry = geometry({
      lowerPrice: 90,
      upperPrice: 110,
      centerPrice: 100,
      position: 0.25,
      lowerLine: {
        startTimestamp: 1,
        startPrice: 90,
        endTimestamp: 2,
        endPrice: 90,
      },
    });
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
      runtimeState({
        timestamp: 2,
        close: 94.9,
        rangeGeometry: driftedGeometry,
      }),
    ]);
    let position: Position | null = null;
    let currentPrice = 95.5;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getCurrentPrice: () => currentPrice,
    });
    const core = await createGridClassicCore({
      config: {
        ...DEFAULT_CONFIG,
        FEE_PERCENT: 0,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);
    const first = (await core(candle(1, 95.5) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 95.5,
      qty: first.orderPlan.qty,
      slPrice: first.orderPlan.stopLossPrice,
      tpPrice: first.orderPlan.takeProfits[0].price,
    };
    currentPrice = 94.9;
    const addition = (await core(candle(2, 94.9) as any, {} as any)) as any;
    const lowerBoundary = addition.signal.figures.lines.find(
      (line: any) => line.kind === 'gridclassic_lower_boundary',
    );

    expect(addition.orderPlan.stopLossPrice).toBe(
      first.orderPlan.stopLossPrice,
    );
    expect(lowerBoundary.points.at(-1).value).toBe(95);
  });

  it('stops additions on the first adverse breakout and exits after confirmation', async () => {
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
      runtimeState({ timestamp: 2, close: 94.7 }),
      runtimeState({ timestamp: 3, close: 94.7 }),
      runtimeState({ timestamp: 4, close: 94.4 }),
    ]);
    let position: Position | null = null;
    let currentPrice = 95.5;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getCurrentPrice: () => currentPrice,
    });
    const core = await createGridClassicCore({
      config: {
        ...DEFAULT_CONFIG,
        FEE_PERCENT: 0,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        GRIDCLASSIC_BREAKOUT_CONFIRM_BARS: 2,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);
    const first = (await core(candle(1, 95.5) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'LONG',
      price: 95.5,
      qty: first.orderPlan.qty,
      slPrice: first.orderPlan.stopLossPrice,
      tpPrice: first.orderPlan.takeProfits[0].price,
    };
    currentPrice = 94.7;

    await expect(core(candle(2, 94.7) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_ADDITIONS_STOPPED',
    });
    await expect(core(candle(3, 94.7) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'GRIDCLASSIC_BREAKOUT_EXIT',
      }),
    );
    expect(strategyApi.exit).toHaveBeenCalledWith({
      code: 'GRIDCLASSIC_BREAKOUT_EXIT',
      direction: 'LONG',
    });

    position = null;
    currentPrice = 94.4;
    await expect(core(candle(4, 94.4) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_COOLDOWN',
    });
  });

  it.each([
    ['center', 100],
    ['opposite_edge', 105],
  ] as const)('uses %s take profit', async (mode, expectedTarget) => {
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 95.5,
    });
    const core = await createGridClassicCore({
      config: {
        ...DEFAULT_CONFIG,
        GRIDCLASSIC_TP_MODE: mode,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(candle(1, 95.5) as any, {} as any)) as any;
    expect(result.orderPlan.takeProfits).toEqual([
      { rate: 1, price: expectedTarget },
    ]);
  });

  it('never opens the opposite side while a position exists', async () => {
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => ({
        symbol: 'TESTUSDT',
        direction: 'SHORT',
        price: 104,
        qty: 1,
        slPrice: 105.5,
        tpPrice: 100,
      }),
      getCurrentPrice: () => 95.5,
    });
    const core = await createGridClassicCore({
      config: DEFAULT_CONFIG as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    const result = await core(candle(1, 95.5) as any, {} as any);
    expect(result.kind).not.toBe('entry');
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });
});
