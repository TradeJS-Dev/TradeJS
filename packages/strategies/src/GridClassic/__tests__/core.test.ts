/** @jest-environment node */

import type { Position } from '@tradejs/types';
import { config as DEFAULT_CONFIG, type GridClassicConfig } from '../config';
import { createGridClassicCore } from '../core';
import {
  createGridClassicEngine,
  type GridClassicRuntimeState,
} from '../engine';
import type { CausalRangeGeometry } from '@tradejs/indicators/range-geometry';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

jest.mock('../engine', () => {
  const actual = jest.requireActual('../engine');
  return { ...actual, createGridClassicEngine: jest.fn() };
});

const mockedCreateGridClassicEngine =
  createGridClassicEngine as jest.MockedFunction<
    typeof createGridClassicEngine
  >;

const BASE_TEST_CONFIG = {
  ...DEFAULT_CONFIG,
  GRIDCLASSIC_ENTRY_CONFIRMATION_BARS: 0,
  GRIDCLASSIC_MAX_PIVOT_AGE_BARS: 0,
  GRIDCLASSIC_MIN_ALTERNATING_PIVOTS: 0,
  GRIDCLASSIC_RECENT_CONTAINMENT_BARS: 0,
  GRIDCLASSIC_MIN_RECENT_CONTAINMENT_RATIO: 0,
  GRIDCLASSIC_MIN_TARGET_DISTANCE_BPS: 0,
  GRIDCLASSIC_MIN_NET_RISK_RATIO: 0,
  GRIDCLASSIC_LEVELS: 4,
  GRIDCLASSIC_REQUIRE_REJECTION_FOR_ADD: false,
  GRIDCLASSIC_FAILED_REJECTION_EXIT_BARS: 0,
  GRIDCLASSIC_BREAKEVEN_TRIGGER_FRACTION: 0,
} as GridClassicConfig;

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
  strategyMode = 'mean_reversion',
  setupId = null,
  setupGeometry = null,
  breakoutLevel = null,
  entrySignalStage,
  setupFamily,
  failedBreakoutDirection,
  reversalDirection,
  candidateTimestamp,
  acceptedTimestamp,
  reclaimTimestamp,
  reclaimAgeBars,
  failedBreakoutLevel,
  projectedBreakoutBoundary,
  projectedRangeCenter,
  sweepExtreme,
  candidateAtr,
}: {
  timestamp: number;
  close: number;
  entryDirection?: 'LONG' | 'SHORT' | null;
  rangeGeometry?: CausalRangeGeometry;
  volatilityShock?: boolean;
  strategyMode?: 'mean_reversion' | 'breakout_continuation';
  setupId?: string | null;
  setupGeometry?: CausalRangeGeometry | null;
  breakoutLevel?: number | null;
  entrySignalStage?:
    | 'none'
    | 'candidate'
    | 'waiting'
    | 'confirmed'
    | 'immediate'
    | 'breakout_candidate'
    | 'breakout_accepted'
    | 'breakout_retest_confirmed'
    | 'failed_breakout_reclaimed';
  setupFamily?: 'failed_breakout_reversal';
  failedBreakoutDirection?: 'LONG' | 'SHORT';
  reversalDirection?: 'LONG' | 'SHORT';
  candidateTimestamp?: number;
  acceptedTimestamp?: number;
  reclaimTimestamp?: number;
  reclaimAgeBars?: number;
  failedBreakoutLevel?: number;
  projectedBreakoutBoundary?: number;
  projectedRangeCenter?: number;
  sweepExtreme?: number;
  candidateAtr?: number;
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
    latestHighPivotAgeBars: 4,
    latestLowPivotAgeBars: 2,
    alternatingPivotCount: 6,
    recentContainmentRatio: 1,
    recentOutsideCloseCount: 0,
    rangeQualityAccepted: true,
    strategyMode,
    setupId,
    setupGeometry,
    breakoutLevel,
    breakoutAgeBars: setupId ? 2 : null,
    entrySignalStage:
      entrySignalStage ?? (entryDirection ? 'immediate' : 'none'),
    entryConfirmationAgeBars: entryDirection ? 0 : null,
    entryDirection,
    ...(setupFamily
      ? {
          setupFamily,
          failedBreakoutDirection: failedBreakoutDirection ?? null,
          reversalDirection: reversalDirection ?? null,
          candidateTimestamp: candidateTimestamp ?? null,
          acceptedTimestamp: acceptedTimestamp ?? null,
          reclaimTimestamp: reclaimTimestamp ?? null,
          reclaimAgeBars: reclaimAgeBars ?? null,
          failedBreakoutLevel: failedBreakoutLevel ?? null,
          projectedBreakoutBoundary: projectedBreakoutBoundary ?? null,
          projectedRangeCenter: projectedRangeCenter ?? null,
          sweepExtreme: sweepExtreme ?? null,
          candidateAtr: candidateAtr ?? null,
        }
      : {}),
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
  stateController = createTestStateController(),
}: {
  getPosition: () => Position | null;
  getCurrentPrice: () => number;
  stateController?: ReturnType<typeof createTestStateController>;
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
    createStateController: stateController,
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
          ...BASE_TEST_CONFIG,
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

  it('builds a one-shot range continuation plan after breakout retest', async () => {
    const setupGeometry = geometry({ position: 1.1 });
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 106,
        entryDirection: 'LONG',
        strategyMode: 'breakout_continuation',
        entrySignalStage: 'breakout_retest_confirmed',
        setupId: 'gridclassic-continuation-long-1',
        setupGeometry,
        breakoutLevel: 105,
        rangeGeometry: geometry({
          detected: false,
          breakoutDirection: 'UP',
          position: 1.1,
        }),
      }),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 106,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_MODE: 'breakout_continuation',
        GRIDCLASSIC_CONTINUATION_TARGET_RANGE_MULT: 1,
        GRIDCLASSIC_CONTINUATION_STOP_INSIDE_RANGE_FRACTION: 0.2,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        FEE_PERCENT: 0,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(candle(1, 106) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'GRIDCLASSIC_UPPER_BREAKOUT_CONTINUATION_LONG',
        orderPlan: expect.objectContaining({
          qty: 10 / 3,
          stopLossPrice: 103,
          takeProfits: [{ rate: 1, price: 116 }],
        }),
      }),
    );
    expect(result.signal.additionalIndicators.gridClassicContext).toEqual(
      expect.objectContaining({
        strategyMode: 'breakout_continuation',
        setupId: 'gridclassic-continuation-long-1',
        breakoutLevel: 105,
        entrySignalStage: 'breakout_retest_confirmed',
        remainingLevels: 0,
      }),
    );
    expect(
      result.signal.additionalIndicators.gridClassicContext,
    ).not.toHaveProperty('setupFamily');
  });

  it('builds a fee-aware one-shot SHORT reversal after an accepted upper breakout reclaim', async () => {
    const setupGeometry = geometry({
      upperPrice: 105.4,
      lowerPrice: 94.6,
      centerPrice: 100,
      position: 0.94,
    });
    mockStates([
      runtimeState({
        timestamp: 3,
        close: 104.8,
        entryDirection: 'SHORT',
        strategyMode: 'breakout_continuation',
        entrySignalStage: 'failed_breakout_reclaimed',
        setupId: 'gridclassic-continuation:LONG:1:105.40000000',
        setupGeometry,
        breakoutLevel: 105.4,
        rangeGeometry: geometry({ detected: false }),
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'LONG',
        reversalDirection: 'SHORT',
        candidateTimestamp: 1,
        acceptedTimestamp: 2,
        reclaimTimestamp: 3,
        reclaimAgeBars: 1,
        failedBreakoutLevel: 105.4,
        projectedBreakoutBoundary: 105.4,
        projectedRangeCenter: 100,
        sweepExtreme: 108,
        candidateAtr: 2,
      }),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 104.8,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_MODE: 'breakout_continuation',
        GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
        GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR: 0.25,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 10,
        FEE_PERCENT: 0.001,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(candle(3, 104.8) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'GRIDCLASSIC_UPPER_FAILED_BREAKOUT_REVERSAL_SHORT',
        orderPlan: {
          qty: expect.closeTo(10 / 4.1266, 10),
          stopLossPrice: 108.5,
          takeProfits: [{ rate: 1, price: 100 }],
        },
      }),
    );
    expect(result.signal.additionalIndicators.gridClassicContext).toEqual(
      expect.objectContaining({
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'LONG',
        reversalDirection: 'SHORT',
        candidateTimestamp: 1,
        acceptedTimestamp: 2,
        reclaimTimestamp: 3,
        reclaimAgeBars: 1,
        projectedBreakoutBoundary: 105.4,
        projectedRangeCenter: 100,
        sweepExtreme: 108,
        candidateAtr: 2,
        remainingLevels: 0,
      }),
    );
  });

  it('builds the mirrored one-shot LONG reversal after an accepted lower breakout reclaim', async () => {
    const setupGeometry = geometry({
      upperPrice: 105.4,
      lowerPrice: 94.6,
      centerPrice: 100,
      position: 0.06,
    });
    mockStates([
      runtimeState({
        timestamp: 3,
        close: 95.2,
        entryDirection: 'LONG',
        strategyMode: 'breakout_continuation',
        entrySignalStage: 'failed_breakout_reclaimed',
        setupId: 'gridclassic-continuation:SHORT:1:94.60000000',
        setupGeometry,
        breakoutLevel: 94.6,
        rangeGeometry: geometry({ detected: false }),
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'SHORT',
        reversalDirection: 'LONG',
        candidateTimestamp: 1,
        acceptedTimestamp: 2,
        reclaimTimestamp: 3,
        reclaimAgeBars: 1,
        failedBreakoutLevel: 94.6,
        projectedBreakoutBoundary: 94.6,
        projectedRangeCenter: 100,
        sweepExtreme: 92,
        candidateAtr: 2,
      }),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 95.2,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_MODE: 'breakout_continuation',
        GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
        GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR: 0.25,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        FEE_PERCENT: 0,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(candle(3, 95.2) as any, {} as any)) as any;

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'GRIDCLASSIC_LOWER_FAILED_BREAKOUT_REVERSAL_LONG',
        orderPlan: {
          qty: expect.closeTo(10 / 3.7, 10),
          stopLossPrice: 91.5,
          takeProfits: [{ rate: 1, price: 100 }],
        },
      }),
    );
  });

  it('uses a distinct target exit for a failed-breakout reversal cycle', async () => {
    const setupGeometry = geometry({
      upperPrice: 105.4,
      lowerPrice: 94.6,
      centerPrice: 100,
      position: 0.94,
    });
    mockStates([
      runtimeState({
        timestamp: 3,
        close: 104.8,
        entryDirection: 'SHORT',
        strategyMode: 'breakout_continuation',
        entrySignalStage: 'failed_breakout_reclaimed',
        setupId: 'gridclassic-continuation:LONG:1:105.40000000',
        setupGeometry,
        breakoutLevel: 105.4,
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'LONG',
        reversalDirection: 'SHORT',
        candidateTimestamp: 1,
        acceptedTimestamp: 2,
        reclaimTimestamp: 3,
        reclaimAgeBars: 1,
        failedBreakoutLevel: 105.4,
        projectedBreakoutBoundary: 105.4,
        projectedRangeCenter: 100,
        sweepExtreme: 108,
        candidateAtr: 2,
      }),
      runtimeState({ timestamp: 4, close: 100 }),
    ]);
    let position: Position | null = null;
    let currentPrice = 104.8;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getCurrentPrice: () => currentPrice,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_MODE: 'breakout_continuation',
        GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
        GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR: 0.25,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        FEE_PERCENT: 0,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);
    const entry = (await core(candle(3, 104.8) as any, {} as any)) as any;
    position = {
      symbol: 'TESTUSDT',
      direction: 'SHORT',
      price: 104.8,
      qty: entry.orderPlan.qty,
      slPrice: entry.orderPlan.stopLossPrice,
      tpPrice: entry.orderPlan.takeProfits[0].price,
    };
    currentPrice = 100;

    await expect(core(candle(4, 100) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_TP_EXIT',
      }),
    );
  });

  it('is idempotent through wrapper recreation and isolates execution economics', async () => {
    const setupGeometry = geometry({
      upperPrice: 105.4,
      lowerPrice: 94.6,
      centerPrice: 100,
      position: 0.94,
    });
    mockStates([
      runtimeState({
        timestamp: 3,
        close: 104.8,
        entryDirection: 'SHORT',
        strategyMode: 'breakout_continuation',
        entrySignalStage: 'failed_breakout_reclaimed',
        setupId: 'gridclassic-continuation:LONG:1:105.40000000',
        setupGeometry,
        breakoutLevel: 105.4,
        setupFamily: 'failed_breakout_reversal',
        failedBreakoutDirection: 'LONG',
        reversalDirection: 'SHORT',
        candidateTimestamp: 1,
        acceptedTimestamp: 2,
        reclaimTimestamp: 3,
        reclaimAgeBars: 1,
        failedBreakoutLevel: 105.4,
        projectedBreakoutBoundary: 105.4,
        projectedRangeCenter: 100,
        sweepExtreme: 108,
        candidateAtr: 2,
      }),
    ]);
    const sharedStateController = createTestStateController();
    const config = {
      ...BASE_TEST_CONFIG,
      GRIDCLASSIC_MODE: 'breakout_continuation',
      GRIDCLASSIC_FAILED_BREAKOUT_REVERSAL_ENABLED: true,
      GRIDCLASSIC_BREAKOUT_TOLERANCE_ATR: 0.25,
      GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
      FEE_PERCENT: 0,
    } as GridClassicConfig;
    const firstApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 104.8,
      stateController: sharedStateController,
    });
    const firstCore = await createGridClassicCore({
      config,
      data: [],
      strategyApi: firstApi,
    } as any);

    await expect(
      firstCore(candle(3, 104.8) as any, {} as any),
    ).resolves.toEqual(expect.objectContaining({ kind: 'entry' }));

    const recreatedApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 104.8,
      stateController: sharedStateController,
    });
    const recreatedCore = await createGridClassicCore({
      config,
      data: [],
      strategyApi: recreatedApi,
    } as any);
    await expect(
      recreatedCore(candle(3, 104.8) as any, {} as any),
    ).resolves.toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_ORDER_PENDING',
    });
    expect(recreatedApi.entry).not.toHaveBeenCalled();

    const isolatedApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 104.8,
      stateController: sharedStateController,
    });
    const isolatedCore = await createGridClassicCore({
      config: { ...config, FEE_PERCENT: 0.002 },
      data: [],
      strategyApi: isolatedApi,
    } as any);
    await expect(
      isolatedCore(candle(3, 104.8) as any, {} as any),
    ).resolves.toEqual(expect.objectContaining({ kind: 'entry' }));

    const disabledSideApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 104.8,
      stateController: sharedStateController,
    });
    const disabledSideCore = await createGridClassicCore({
      config: {
        ...config,
        SHORT: { enable: false, direction: 'SHORT' },
      },
      data: [],
      strategyApi: disabledSideApi,
    } as any);
    await expect(
      disabledSideCore(candle(3, 104.8) as any, {} as any),
    ).resolves.toEqual({ kind: 'skip', code: 'STRATEGY_DISABLED' });
  });

  it('rejects an extended continuation entry after the confirmed retest', async () => {
    const setupGeometry = geometry({ position: 1.1 });
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 106,
        entryDirection: 'LONG',
        strategyMode: 'breakout_continuation',
        entrySignalStage: 'breakout_retest_confirmed',
        setupId: 'gridclassic-continuation-long-extended',
        setupGeometry,
        breakoutLevel: 105,
        rangeGeometry: geometry({
          detected: false,
          breakoutDirection: 'UP',
          position: 1.1,
        }),
      }),
    ]);
    const strategyApi = makeStrategyApi({
      getPosition: () => null,
      getCurrentPrice: () => 106,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_MODE: 'breakout_continuation',
        GRIDCLASSIC_CONTINUATION_MAX_ENTRY_DISTANCE_ATR: 0.5,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    const result = (await core(candle(1, 106) as any, {} as any)) as any;

    expect(result).toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_CONTINUATION_ENTRY_TOO_EXTENDED',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

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
        ...BASE_TEST_CONFIG,
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

  it('waits for a new frozen-boundary rejection before adding', async () => {
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
      runtimeState({ timestamp: 2, close: 94.9 }),
      runtimeState({ timestamp: 3, close: 95.1 }),
    ]);
    let position: Position | null = null;
    let currentPrice = 95.5;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getCurrentPrice: () => currentPrice,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        FEE_PERCENT: 0,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        GRIDCLASSIC_REQUIRE_REJECTION_FOR_ADD: true,
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

    await expect(core(candle(2, 94.9) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_SCALE_IN_WAIT_REJECTION',
    });

    currentPrice = 95.1;
    const rejection = candle(3, 95.1);
    const addition = (await core(
      {
        ...rejection,
        open: 94.8,
        high: 95.3,
        low: 94.3,
      } as any,
      {} as any,
    )) as any;
    expect(addition).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'GRIDCLASSIC_SCALE_IN_2',
      }),
    );
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
        ...BASE_TEST_CONFIG,
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
        ...BASE_TEST_CONFIG,
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

  it('exits before the breakout buffer when a rejection immediately fails', async () => {
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
        ...BASE_TEST_CONFIG,
        FEE_PERCENT: 0,
        GRIDCLASSIC_RISK_SLIPPAGE_BPS: 0,
        GRIDCLASSIC_BREAKOUT_CONFIRM_BARS: 2,
        GRIDCLASSIC_FAILED_REJECTION_EXIT_BARS: 1,
        GRIDCLASSIC_FAILED_REJECTION_TOLERANCE_ATR: 0,
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

    await expect(core(candle(2, 94.9) as any, {} as any)).resolves.toEqual(
      expect.objectContaining({
        kind: 'exit',
        code: 'GRIDCLASSIC_FAILED_REJECTION_EXIT',
      }),
    );
  });

  it('protects recovered profit with a cost-adjusted break-even stop', async () => {
    mockStates([
      runtimeState({
        timestamp: 1,
        close: 95.5,
        entryDirection: 'LONG',
      }),
      runtimeState({ timestamp: 2, close: 98 }),
    ]);
    let position: Position | null = null;
    let currentPrice = 95.5;
    const strategyApi = makeStrategyApi({
      getPosition: () => position,
      getCurrentPrice: () => currentPrice,
    });
    const core = await createGridClassicCore({
      config: {
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_LEVELS: 1,
        GRIDCLASSIC_BREAKEVEN_TRIGGER_FRACTION: 0.5,
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
    currentPrice = 98;

    const protection = (await core(candle(2, 98) as any, {} as any)) as any;
    expect(protection).toEqual(
      expect.objectContaining({
        kind: 'protect',
        code: 'GRIDCLASSIC_REFRESH_PROTECTION',
      }),
    );
    expect(protection.protectPlan.stopLossPrice).toBeGreaterThan(
      position.price,
    );
    expect(protection.protectPlan.stopLossPrice).toBeLessThan(currentPrice);
  });

  it('rejects an entry whose target is too close after execution costs', async () => {
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
        ...BASE_TEST_CONFIG,
        GRIDCLASSIC_MIN_TARGET_DISTANCE_BPS: 1_000,
      } as GridClassicConfig,
      data: [],
      strategyApi,
    } as any);

    await expect(core(candle(1, 95.5) as any, {} as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GRIDCLASSIC_TARGET_DISTANCE_REJECTED',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
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
        ...BASE_TEST_CONFIG,
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
      config: BASE_TEST_CONFIG,
      data: [],
      strategyApi,
    } as any);

    const result = await core(candle(1, 95.5) as any, {} as any);
    expect(result.kind).not.toBe('entry');
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });
});
