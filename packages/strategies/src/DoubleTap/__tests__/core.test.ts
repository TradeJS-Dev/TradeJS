/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createDoubleTapCore } from '../core';
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

const makeDoubleBottomCandles = () => [
  makeCandle(0, 100, 101, 95, 100),
  makeCandle(1, 100, 100, 88, 90),
  makeCandle(2, 90, 111, 89, 110),
  makeCandle(3, 110, 99, 85, 90),
  makeCandle(4, 92, 106, 86, 104),
  makeCandle(5, 104, 104, 86, 100),
  makeCandle(6, 100, 105, 86, 104),
  makeCandle(7, 104, 104, 86, 104),
  makeCandle(8, 104, 108, 90, 107),
];

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({
      baseContext: {},
    })),
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
    getBaseContext: jest.fn(() => ({
      raw: { volatility: { bbWidthPct: 5 } },
    })),
    getCurrentPosition: jest.fn(async () => currentPosition),
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
        strategy: 'DoubleTap',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: marketData.timestamp,
        prices: {
          currentPrice: marketData.currentPrice,
          takeProfitPrice: params.orderPlan.takeProfits[0].price,
          stopLossPrice: params.orderPlan.stopLossPrice,
          riskRatio: 1,
        },
        isConfigFromBacktest: false,
      },
      orderPlan: params.orderPlan,
      signal: {
        signalId: 'doubletap-test-signal',
        strategy: 'DoubleTap',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: marketData.timestamp,
        figures: params.figures ?? {},
        prices: {
          currentPrice: marketData.currentPrice,
          takeProfitPrice: params.orderPlan.takeProfits[0].price,
          stopLossPrice: params.orderPlan.stopLossPrice,
          riskRatio: 1,
        },
        indicators: params.indicators ?? {},
        additionalIndicators: params.additionalIndicators,
      },
    })),
    exit: jest.fn(async (params: any) => ({
      kind: 'exit',
      code: params.code,
      closePlan: {
        direction: params.direction,
        price: marketData.currentPrice,
        timestamp: marketData.timestamp,
      },
    })),
  }) as any;

describe('DoubleTap core', () => {
  it('creates long entry with figures on double bottom breakout', async () => {
    const candles = makeDoubleBottomCandles();
    const currentCandle = candles[candles.length - 1];
    const initialCandles = candles.slice(0, -1);
    const marketData = {
      fullData: candles,
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({ marketData });

    const core = await createDoubleTapCore({
      config: {
        ...DEFAULT_CONFIG,
        DOUBLETAP_PIVOT_LENGTH: 2,
        DOUBLETAP_MIN_PATTERN_HEIGHT_PCT: 0,
        DOUBLETAP_MIN_PATTERN_HEIGHT_ATR: 0,
        DOUBLETAP_MIN_TAP_SPACING_BARS: 1,
        DOUBLETAP_MIN_LEG_SYMMETRY_RATIO: 0,
        DOUBLETAP_MIN_BREAKOUT_DISTANCE_ATR: 0,
        DOUBLETAP_MAX_BREAKOUT_DISTANCE_HEIGHT_RATIO: 0,
        DOUBLETAP_MAX_BREAKOUT_DISTANCE_PCT: 5,
        DOUBLETAP_ENTRY_MODE: 'breakout',
        LONG: {
          ...DEFAULT_CONFIG.LONG,
          minRiskRatio: 0.5,
        },
      } as any,
      data: initialCandles,
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result.kind).toBe('entry');
    expect((result as any).code).toBe('DOUBLETAP_DOUBLE_BOTTOM_BREAKOUT');
    expect((result as any).entryContext.direction).toBe('LONG');
    expect((result as any).signal.figures.lines).toHaveLength(4);
    expect(
      (result as any).signal.additionalIndicators.doubleTapContext.patternKind,
    ).toBe('double_bottom');
  });

  it('exits existing long on opposite double top pattern', async () => {
    const currentCandle = makeCandle(10, 100, 101, 99, 100);
    const strategyApi = makeStrategyApi({
      marketData: {
        fullData: [currentCandle],
        timestamp: currentCandle.timestamp,
        currentPrice: currentCandle.close,
      },
      currentPosition: {
        direction: 'LONG',
        price: 100,
        qty: 1,
      },
    });
    const core = await createDoubleTapCore({
      config: DEFAULT_CONFIG as any,
      data: [],
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result).toEqual({ kind: 'skip', code: 'NO_PATTERN' });
  });
});
