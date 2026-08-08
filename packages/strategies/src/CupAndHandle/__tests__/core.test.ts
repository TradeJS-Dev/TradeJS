/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createCupAndHandleCore } from '../core';
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

const makeCupAndHandleCandles = () => [
  makeCandle(0, 100, 101, 99, 100),
  makeCandle(1, 100, 110, 100, 108),
  makeCandle(2, 106, 106, 96, 99),
  makeCandle(3, 98, 99, 80, 82),
  makeCandle(4, 84, 100, 88, 98),
  makeCandle(5, 100, 109, 98, 107),
  makeCandle(6, 105, 105, 98, 99),
  makeCandle(7, 99, 101, 96, 97),
  makeCandle(8, 98, 106, 98, 104),
  makeCandle(9, 105, 113, 103, 112),
];

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

const makeStrategyApi = (marketData: any) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getDecisionPriceContext: jest.fn(async () => ({
      timestamp: marketData.timestamp,
      currentPrice: marketData.currentPrice,
      candle: marketData.lastCandle,
    })),
    getCurrentPosition: jest.fn(async () => null),
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
        strategy: 'CupAndHandle',
        direction: params.direction,
      },
      orderPlan: params.orderPlan,
      signal: {
        strategy: 'CupAndHandle',
        direction: params.direction,
        figures: params.figures,
        additionalIndicators: params.additionalIndicators,
      },
    })),
    exit: jest.fn(),
  }) as any;

describe('CupAndHandle core', () => {
  it('creates a long entry with geometry and signal context', async () => {
    const candles = makeCupAndHandleCandles();
    const currentCandle = candles[candles.length - 1];
    const strategyApi = makeStrategyApi({
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
      lastCandle: currentCandle,
    });
    const core = await createCupAndHandleCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
        CUPHANDLE_PIVOT_LOOKBACK: 1,
        CUPHANDLE_RIM_TOLERANCE_PCT: 20,
        CUPHANDLE_MIN_CUP_DEPTH_PCT: 0,
        CUPHANDLE_MIN_CUP_DEPTH_ATR: 0,
        CUPHANDLE_MIN_CUP_BARS: 2,
        CUPHANDLE_MIN_CUP_SYMMETRY_RATIO: 0,
        CUPHANDLE_MIN_HANDLE_BARS: 1,
        CUPHANDLE_MIN_HANDLE_DEPTH_RATIO: 0.01,
        CUPHANDLE_MAX_HANDLE_DEPTH_RATIO: 0.6,
        CUPHANDLE_MIN_BREAKOUT_DISTANCE_ATR: 0,
        CUPHANDLE_MAX_BREAKOUT_DISTANCE_DEPTH_RATIO: 1,
        CUPHANDLE_MAX_BREAKOUT_DISTANCE_PCT: 5,
        CUPHANDLE_ENTRY_MODE: 'breakout',
        LONG: { ...DEFAULT_CONFIG.LONG, minRiskRatio: 0.5 },
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result.kind).toBe('entry');
    expect((result as any).code).toBe('CUPHANDLE_CUP_AND_HANDLE_BREAKOUT');
    expect((result as any).entryContext.direction).toBe('LONG');
    expect((result as any).signal.figures.lines).toHaveLength(5);
    expect(
      (result as any).signal.additionalIndicators.cupAndHandleContext
        .patternKind,
    ).toBe('cup_and_handle');
  });
});
