/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createTrendShiftCore } from '../core';
import { filterByVeryVolatilityCandles } from '../filters';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
  filterByVeryVolatilityCandles: jest.fn(() => true),
}));

const makeCandle = (
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeFlatCandles = (count: number, start = 1_700_000_000_000) =>
  Array.from({ length: count }, (_, index) =>
    makeCandle(start + index * 60_000, 100, 101, 99, 100),
  );

const makeBullFlipCandle = (timestamp: number) =>
  makeCandle(timestamp, 100, 150, 99, 145);

const makeBearFlipCandle = (timestamp: number) =>
  makeCandle(timestamp, 145, 146, 80, 82);

let activeIndicatorsState: any;

const getMockIndicatorsContext = () => {
  const indicators = activeIndicatorsState?.snapshot?.();
  return {
    indicators,
    baseContext: indicators?.baseContext,
  };
};

const makeStrategyApi = ({
  marketData,
  currentPosition = null,
}: {
  marketData: any;
  currentPosition?: any;
}) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getMarketData: jest.fn(async () => marketData),
    getCurrentIndicatorsContext: jest.fn(getMockIndicatorsContext),
    getBaseContext: jest.fn(() => getMockIndicatorsContext().baseContext),
    getDecisionPriceContext: jest.fn(async () => {
      const baseContext = getMockIndicatorsContext().baseContext;
      return {
        timestamp: baseContext?.candle?.timestamp ?? marketData?.timestamp ?? 0,
        currentPrice:
          baseContext?.candle?.close ?? marketData?.currentPrice ?? 0,
        candle: baseContext?.candle,
      };
    }),
    getCurrentPosition: jest.fn(async () => currentPosition),
    isCurrentPositionExists: jest.fn(async () =>
      Boolean(currentPosition && currentPosition.qty > 0),
    ),
    getDirectionalTpSlPrices: jest.fn(({ price, direction }) => ({
      stopLossPrice: direction === 'LONG' ? price * 0.989 : price * 1.011,
      takeProfitPrice: direction === 'LONG' ? price * 1.028 : price * 0.972,
      riskRatio: 2.1,
      qty: 1,
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
        strategy: 'TrendShift',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: marketData.timestamp,
        prices: {
          currentPrice: marketData.currentPrice,
          takeProfitPrice: params.orderPlan.takeProfits[0].price,
          stopLossPrice: params.orderPlan.stopLossPrice,
          riskRatio: 2.1,
        },
        isConfigFromBacktest: false,
      },
      orderPlan: params.orderPlan,
      signal: {
        signalId: 'trendshift-test-signal',
        strategy: 'TrendShift',
        symbol: 'TESTUSDT',
        interval: '15',
        direction: params.direction,
        timestamp: marketData.timestamp,
        figures: params.figures ?? {},
        prices: {
          currentPrice: marketData.currentPrice,
          takeProfitPrice: params.orderPlan.takeProfits[0].price,
          stopLossPrice: params.orderPlan.stopLossPrice,
          riskRatio: 2.1,
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

const makeIndicatorsState = (overrides: Record<string, unknown> = {}) => {
  activeIndicatorsState = {
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({
      baseContext: {
        raw: {
          trend: {
            maFast: 120,
            maSlow: 110,
          },
        },
        regime: {
          session: {
            sessionPhase: 'off_hours',
            isOverlap: false,
          },
          volatility: {
            atrPctZScore: 0.6,
          },
        },
        structure: {
          localRange: {
            breakoutState: 'above_high_level',
          },
        },
        participation: {
          volume: {
            volumeRel20: 1.4,
          },
        },
        relative: {
          benchmark: {
            relativeStrength1h: 0.2,
          },
        },
        derivatives: {
          summary: {
            pressure: 'short_flush',
            directionAligned: true,
            riskFlags: ['short_liquidation_spike'],
            priceOiDivergenceType: 'price_up_oi_up',
          },
        },
      },
      ...overrides,
    })),
    latestNumber: jest.fn(() => undefined),
    isInitialized: jest.fn(() => true),
  };
  return activeIndicatorsState as any;
};

describe('TrendShift core', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    activeIndicatorsState = undefined;
    (filterByVeryVolatilityCandles as jest.Mock).mockReturnValue(true);
  });

  it('creates long entry on confirmed bullish flip', async () => {
    const initialCandles = makeFlatCandles(220);
    const currentCandle = makeBullFlipCandle(
      initialCandles[initialCandles.length - 1].timestamp + 60_000,
    );
    const marketData = {
      fullData: [...initialCandles, currentCandle],
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({ marketData });

    const core = await createTrendShiftCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: DEFAULT_CONFIG as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: initialCandles,
      btcData: initialCandles,
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result.kind).toBe('entry');
    expect((result as any).code).toBe('TRENDSHIFT_BULLISH_FLIP');
    expect((result as any).entryContext.direction).toBe('LONG');
    expect(
      (result as any).signal.additionalIndicators?.trendShiftContext
        ?.baseContext,
    ).toBeUndefined();
    expect(strategyApi.entry).toHaveBeenCalledTimes(1);
  });

  it('creates entry when derivatives context is absent but flip is q5-strong', async () => {
    const initialCandles = makeFlatCandles(220);
    const currentCandle = makeBullFlipCandle(
      initialCandles[initialCandles.length - 1].timestamp + 60_000,
    );
    const marketData = {
      fullData: [...initialCandles, currentCandle],
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({ marketData });

    const core = await createTrendShiftCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: DEFAULT_CONFIG as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: initialCandles,
      btcData: initialCandles,
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState({
        baseContext: {
          raw: {
            trend: {
              maFast: 120,
              maSlow: 110,
            },
          },
          regime: {
            session: {
              sessionPhase: 'off_hours',
              isOverlap: false,
            },
            volatility: {
              atrPctZScore: 0.6,
            },
          },
          structure: {
            localRange: {
              breakoutState: 'above_high_level',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.4,
            },
          },
          relative: {
            benchmark: {
              relativeStrength1h: 0.2,
            },
          },
        },
      }),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result.kind).toBe('entry');
    expect(strategyApi.entry).toHaveBeenCalledTimes(1);
  });

  it('returns VERY_VOLATILITY when filter rejects market data', async () => {
    const initialCandles = makeFlatCandles(220);
    const currentCandle = makeBullFlipCandle(
      initialCandles[initialCandles.length - 1].timestamp + 60_000,
    );
    const marketData = {
      fullData: [...initialCandles, currentCandle],
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({ marketData });
    (filterByVeryVolatilityCandles as jest.Mock).mockReturnValueOnce(false);

    const core = await createTrendShiftCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: DEFAULT_CONFIG as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: initialCandles,
      btcData: initialCandles,
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result).toEqual({ kind: 'skip', code: 'VERY_VOLATILITY' });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it('exits open long on confirmed bearish flip', async () => {
    const initialCandles = [
      ...makeFlatCandles(220),
      makeBullFlipCandle(1_700_000_000_000 + 220 * 60_000),
    ];
    const currentCandle = makeBearFlipCandle(
      initialCandles[initialCandles.length - 1].timestamp + 60_000,
    );
    const marketData = {
      fullData: [...initialCandles, currentCandle],
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({
      marketData,
      currentPosition: {
        direction: 'LONG',
        price: 145,
        qty: 1,
      },
    });

    const core = await createTrendShiftCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: DEFAULT_CONFIG as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: initialCandles,
      btcData: initialCandles,
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result.kind).toBe('exit');
    expect((result as any).code).toBe('TRENDSHIFT_OPPOSITE_FLIP_EXIT');
    expect(strategyApi.exit).toHaveBeenCalledTimes(1);
  });

  it('skips long entry when crowded-long derivatives are anti-aligned', async () => {
    const initialCandles = makeFlatCandles(220);
    const currentCandle = makeBullFlipCandle(
      initialCandles[initialCandles.length - 1].timestamp + 60_000,
    );
    const marketData = {
      fullData: [...initialCandles, currentCandle],
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({ marketData });

    const core = await createTrendShiftCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: DEFAULT_CONFIG as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: initialCandles,
      btcData: initialCandles,
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState({
        baseContext: {
          raw: {
            trend: {
              maFast: 120,
              maSlow: 110,
            },
          },
          regime: {
            session: {
              sessionPhase: 'us',
              isOverlap: false,
            },
            volatility: {
              atrPctZScore: 0.7,
            },
          },
          structure: {
            localRange: {
              breakoutState: 'above_high_level',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.5,
            },
          },
          relative: {
            benchmark: {
              relativeStrength1h: 0.3,
            },
          },
          derivatives: {
            summary: {
              pressure: 'crowded_long',
              directionAligned: false,
              riskFlags: [],
              priceOiDivergenceType: 'price_up_oi_down',
            },
          },
        },
      }),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result).toEqual({
      kind: 'skip',
      code: 'TRENDSHIFT_GUARDRAIL_LONG_CROWDED_PRESSURE',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it('skips US short entry when long-flush move lacks downside OI expansion', async () => {
    const initialCandles = [
      ...makeFlatCandles(220),
      makeBullFlipCandle(1_700_000_000_000 + 220 * 60_000),
    ];
    const currentCandle = makeBearFlipCandle(
      initialCandles[initialCandles.length - 1].timestamp + 60_000,
    );
    const marketData = {
      fullData: [...initialCandles, currentCandle],
      timestamp: currentCandle.timestamp,
      currentPrice: currentCandle.close,
    };
    const strategyApi = makeStrategyApi({ marketData });

    const core = await createTrendShiftCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: DEFAULT_CONFIG as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: initialCandles,
      btcData: initialCandles,
      loadPineScriptFile: jest.fn(),
      strategyApi,
      indicatorsState: makeIndicatorsState({
        baseContext: {
          raw: {
            trend: {
              maFast: 90,
              maSlow: 110,
            },
          },
          regime: {
            session: {
              sessionPhase: 'us',
              isOverlap: false,
            },
            volatility: {
              atrPctZScore: 0.7,
            },
          },
          structure: {
            localRange: {
              breakoutState: 'below_low_level',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.5,
            },
          },
          relative: {
            benchmark: {
              relativeStrength1h: -0.3,
            },
          },
          derivatives: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
              priceOiDivergenceType: 'price_down_oi_down',
            },
          },
        },
      }),
    });

    const result = await core(currentCandle as any, currentCandle as any);

    expect(result).toEqual({
      kind: 'skip',
      code: 'TRENDSHIFT_GUARDRAIL_US_SHORT_OI_NOT_EXPANDING',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });
});
