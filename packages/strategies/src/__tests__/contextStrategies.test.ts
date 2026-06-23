/** @jest-environment node */

import { config as DFR_DEFAULT_CONFIG } from '../DerivativesFlushReversal/config';
import { createDerivativesFlushReversalCore } from '../DerivativesFlushReversal/core';
import { config as RR_DEFAULT_CONFIG } from '../RelativeRotation/config';
import { createRelativeRotationCore } from '../RelativeRotation/core';
import { config as VCB_DEFAULT_CONFIG } from '../VolatilityCompressionBreakout/config';
import { createVolatilityCompressionBreakoutCore } from '../VolatilityCompressionBreakout/core';

const makeCandle = (price: number) => ({
  timestamp: 1_700_000_000_000,
  dt: new Date(1_700_000_000_000).toISOString(),
  open: price - 0.4,
  high: price + 1,
  low: price - 2,
  close: price,
  volume: 2_000,
  turnover: price * 2_000,
});

const makeBaseContext = (overrides: Record<string, unknown> = {}) => {
  const candle = makeCandle(100);
  return {
    candle,
    prevCandle: makeCandle(99),
    raw: {
      trend: { maFast: 101, maMedium: 100, maSlow: 99 },
      volatility: {
        atr: 2,
        atrPct: 0.02,
        bbUpper: 104,
        bbMiddle: 100,
        bbLower: 96,
        bbWidthPct: 8,
      },
      momentum: { macd: 1, macdSignal: 0.5, macdHistogram: 0.5 },
      volume: {
        volume: candle.volume,
        turnover: candle.turnover,
        obv: 100,
        obvSma: 90,
        volume1h: 10_000,
        volume24h: 200_000,
      },
      price: {
        prevClose: 99,
        price1hPct: 0.5,
        price24hPct: 2,
        highPrice1h: 102,
        lowPrice1h: 98,
        highPrice24h: 110,
        lowPrice24h: 90,
      },
      levels: { highLevel: 99.5, lowLevel: 98 },
      crossAsset: { btcCorrelation: 0.4 },
    },
    regime: {
      trend: { bias: 'bull' },
      volatility: {
        state: 'compressed',
        percentiles: {
          atrPctRank100: 20,
          bbWidthRank100: 25,
          realizedVolRank100: 30,
          rangeExpansionRank20: 80,
        },
      },
      momentum: {},
      session: {
        sessionPhase: 'us',
        sessionWindowPhase: 'active',
        isOverlap: true,
      },
      memory: {},
    },
    structure: {
      localRange: {
        rangePosition20: 0.2,
        breakoutState: 'above_high_level',
      },
      acceptance: {
        breakoutBodyAtr: 0.45,
      },
      zones: {
        support: { lower: 97.8, level: 98.2 },
        resistance: { upper: 99.5, level: 99.2 },
      },
      srZones: {
        nearestResistance: { level: 99.5 },
        nearestSupport: { level: 98 },
        crossedAbove: true,
        crossedBelow: false,
      },
      structureZones: {},
      liquidity: {
        sweepState: 'swept_low',
        sweepWickPct: 0.4,
      },
      liquidityTails: {
        currentTail: {
          side: 'lower',
        },
      },
    },
    participation: {
      volume: {
        volumeRel20: 1.5,
        turnoverRel20: 1.4,
      },
      delta: {
        buyPressurePct: 0.62,
        deltaDivergenceVsPrice: 'bullish',
      },
      tradeFlow: {
        buyPressurePct: 0.6,
        stale: false,
      },
    },
    relative: {
      benchmark: {
        relativeStrength1h: 0.35,
        trendAlignment: 'aligned_bull',
      },
      targetVsBtc: {
        ratioReturn1h: 0.2,
        ratioReturn4h: 0.5,
        ratioReturn24h: 0.8,
        alphaVsBtc1h: 0.3,
        alphaVsBtc4h: 0.7,
        alphaVsBtc24h: 1.2,
        betaToBtc20: 0.7,
        correlationToBtc20: 0.4,
        ratioTrend: 'up',
      },
      targetVsEth: {
        ratioReturn24h: 0.3,
        alphaVsEth24h: 0.4,
        ratioTrend: 'up',
      },
      marketBreadth: {
        equalWeightedReturn: 0.01,
        stale: false,
      },
      btcAltRegime: {
        regime: 'alt_lead',
        stale: false,
      },
    },
    derivatives: {
      summary: {
        pressure: 'long_flush',
        riskFlags: ['long_liquidation_spike'],
        directionAligned: true,
        priceOiDivergenceType: 'price_down_oi_up',
      },
      intervals: {
        '15m': {
          liqImbalance: -0.7,
          liqSpikeRatio: 3,
          fundingZScore: -1.2,
        },
      },
    },
    mtf: {
      candles: { m15: [], h1: [], h4: [], d1: [] },
      benchmarkCandles: { m15: [], h1: [], h4: [], d1: [] },
      summary: {
        mtfAlignment: 'aligned_bull',
      },
    },
    ...overrides,
  } as any;
};

const makeIndicatorsState = (baseContext: any) =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({ baseContext })),
    latestNumber: jest.fn(() => undefined),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeStrategyApi = (currentPrice = 101) => {
  const lastTradeController = {
    isInCooldown: jest.fn(() => false),
    markTrade: jest.fn(),
    getLastTradeTimestamp: jest.fn(() => null),
  };
  const strategyApi = {
    skip: jest.fn((code: string) => ({ kind: 'skip', code })),
    entry: jest.fn(async (params: any) => ({
      kind: 'entry',
      code: params.code,
      direction: params.direction,
      additionalIndicators: params.additionalIndicators,
      figures: params.figures,
      orderPlan: params.orderPlan,
    })),
    exit: jest.fn(async (params: any) => ({
      kind: 'exit',
      code: params.code,
      closePlan: params,
    })),
    protect: jest.fn(),
    getMarketData: jest.fn(async () => ({
      fullData: [makeCandle(currentPrice)],
      lastCandle: makeCandle(currentPrice),
      timestamp: 1_700_000_000_000,
      currentPrice,
    })),
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(async () => null),
    isCurrentPositionExists: jest.fn(async () => false),
    getDirectionalTpSlPrices: jest.fn(),
    createLastTradeController: jest.fn(() => lastTradeController),
  } as any;

  return { strategyApi, lastTradeController };
};

const makeCoreParams = ({
  config,
  strategyApi,
  baseContext,
}: {
  config: any;
  strategyApi: any;
  baseContext: any;
}) => ({
  userName: 'root',
  symbol: 'TESTUSDT',
  config,
  isConfigFromBacktest: false,
  connector: {} as any,
  data: [],
  btcData: [],
  loadPineScriptFile: jest.fn(),
  strategyApi,
  indicatorsState: makeIndicatorsState(baseContext),
});

describe('context strategies', () => {
  it('opens DerivativesFlushReversal long on a swept long-liquidation flush', async () => {
    const baseContext = makeBaseContext();
    const { strategyApi, lastTradeController } = makeStrategyApi(101);
    const core = await createDerivativesFlushReversalCore(
      makeCoreParams({
        config: DFR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'DFR_LONG_FLUSH_REVERSAL',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          derivativesFlushReversalContext: expect.objectContaining({
            signalDirection: 'LONG',
            pressure: 'long_flush',
            structureConfirmed: true,
          }),
        },
      }),
    );
    expect((result as any).orderPlan.stopLossPrice).toBeLessThan(101);
    expect((result as any).figures.points).toHaveLength(1);
    expect(lastTradeController.markTrade).toHaveBeenCalledWith(
      baseContext.candle.timestamp,
    );
  });

  it('opens DerivativesFlushReversal from structure when derivatives are not available in core', async () => {
    const baseContext = makeBaseContext({ derivatives: undefined });
    const { strategyApi } = makeStrategyApi(101);
    const core = await createDerivativesFlushReversalCore(
      makeCoreParams({
        config: DFR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'DFR_LONG_FLUSH_REVERSAL',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          derivativesFlushReversalContext: expect.objectContaining({
            signalDirection: 'LONG',
            signalSource: 'structure',
            structureConfirmed: true,
          }),
        },
      }),
    );
  });

  it('opens VolatilityCompressionBreakout long after compressed range expansion', async () => {
    const baseContext = makeBaseContext();
    const { strategyApi } = makeStrategyApi(101);
    const core = await createVolatilityCompressionBreakoutCore(
      makeCoreParams({
        config: VCB_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'VCB_LONG_COMPRESSION_BREAKOUT',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          volatilityCompressionBreakoutContext: expect.objectContaining({
            signalDirection: 'LONG',
            compressionConfirmed: true,
            expansionConfirmed: true,
          }),
        },
      }),
    );
    expect((result as any).orderPlan.stopLossPrice).toBeLessThan(101);
  });

  it('opens RelativeRotation long on positive target-vs-BTC alpha', async () => {
    const baseContext = makeBaseContext();
    const { strategyApi } = makeStrategyApi(101);
    const core = await createRelativeRotationCore(
      makeCoreParams({
        config: RR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'RR_LONG_RELATIVE_ROTATION',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          relativeRotationContext: expect.objectContaining({
            signalDirection: 'LONG',
            targetVsBtcRatioTrend: 'up',
            alphaConfirmed: true,
          }),
        },
      }),
    );
    expect((result as any).orderPlan.stopLossPrice).toBeLessThan(101);
  });
});
