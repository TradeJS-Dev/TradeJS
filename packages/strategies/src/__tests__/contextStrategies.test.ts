/** @jest-environment node */

import { config as MFR_DEFAULT_CONFIG } from '../MarketFlushReversal/config';
import { createMarketFlushReversalCore } from '../MarketFlushReversal/core';
import { buildMarketFlushReversalGuardrailContext } from '../MarketFlushReversal/guardrails';
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

const makeCalibratedMarketFlushBaseContext = () => {
  const baseContext = makeBaseContext();
  baseContext.relative.targetVsBtc.ratioReturn24h = -3.3;
  baseContext.relative.cmcReferenceAssets = {
    ethVsBtcVolumeRatio: 0.54,
  };
  baseContext.mtf.summary.h1RangePosition = 0.2;
  baseContext.relative.cmcIndexes = {
    indexRegime: 'risk_off',
    stale: false,
  };
  baseContext.regime.momentum.rsiState = 'oversold';
  baseContext.gateFeatures = {
    setup: {
      stopDistanceAtr: 24,
    },
  };
  return baseContext;
};

const makeShortMarketFlushBaseContext = () => {
  const candle = {
    ...makeCandle(100),
    open: 100.4,
    high: 102,
    low: 99,
    close: 100,
  };
  const baseContext = makeBaseContext({ candle });
  baseContext.raw.levels.highLevel = 102.5;
  baseContext.structure.localRange.rangePosition20 = 0.8;
  baseContext.structure.localRange.breakoutState = 'failed_high_breakout';
  baseContext.structure.zones.resistance = { upper: 102.2, level: 102 };
  baseContext.structure.liquidity.sweepState = 'swept_high';
  baseContext.structure.liquidityTails.currentTail.side = 'upper';
  baseContext.participation.delta.buyPressurePct = 0.38;
  baseContext.participation.delta.deltaDivergenceVsPrice = 'bearish';
  baseContext.derivatives.summary.pressure = 'short_flush';
  baseContext.derivatives.summary.riskFlags = ['short_liquidation_spike'];
  baseContext.derivatives.summary.priceOiDivergenceType = 'price_up_oi_up';
  baseContext.derivatives.intervals['15m'].liqImbalance = 0.7;
  return baseContext;
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
    getCurrentIndicatorsContext: jest.fn(() => ({
      indicators: undefined,
      baseContext: undefined,
    })),
    getBaseContext: jest.fn(() => undefined),
    getDecisionPriceContext: jest.fn(async () => ({
      timestamp: 1_700_000_000_000,
      currentPrice,
      candle: makeCandle(currentPrice),
    })),
    getCurrentPosition: jest.fn(async () => null),
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
}) => {
  const indicatorsState = makeIndicatorsState(baseContext);
  strategyApi.getCurrentIndicatorsContext.mockImplementation(() => {
    const indicators = indicatorsState.snapshot();
    return {
      indicators,
      baseContext: indicators.baseContext,
    };
  });
  strategyApi.getBaseContext.mockImplementation(
    () => strategyApi.getCurrentIndicatorsContext().baseContext,
  );

  return {
    userName: 'root',
    symbol: 'TESTUSDT',
    config,
    isConfigFromBacktest: false,
    connector: {} as any,
    data: [],
    btcData: [],
    loadPineScriptFile: jest.fn(),
    strategyApi,
    indicatorsState,
  };
};

describe('context strategies', () => {
  it('opens MarketFlushReversal long on a swept long-liquidation flush', async () => {
    const baseContext = makeCalibratedMarketFlushBaseContext();
    const { strategyApi, lastTradeController } = makeStrategyApi(101);
    const core = await createMarketFlushReversalCore(
      makeCoreParams({
        config: MFR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'MFR_LONG_FLUSH_REVERSAL',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          marketFlushReversalContext: expect.objectContaining({
            signalDirection: 'LONG',
            marketPressure: 'long_flush',
            marketFlushConfirmed: true,
            structureConfirmed: true,
          }),
        },
      }),
    );
    expect((result as any).orderPlan.stopLossPrice).toBeLessThan(101);
    expect((result as any).figures.points).toHaveLength(2);
    expect((result as any).figures.annotations[0]).toEqual(
      expect.objectContaining({
        kind: 'market_flush_reversal_entry_evidence',
        title: 'Market flush reversal LONG',
      }),
    );
    expect(lastTradeController.markTrade).toHaveBeenCalledWith(
      baseContext.candle.timestamp,
    );
  });

  it('opens MarketFlushReversal local structure candidate when derivatives are not available in core', async () => {
    const baseContext = makeCalibratedMarketFlushBaseContext();
    baseContext.derivatives = undefined;
    const { strategyApi } = makeStrategyApi(101);
    const core = await createMarketFlushReversalCore(
      makeCoreParams({
        config: MFR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'MFR_LONG_FLUSH_REVERSAL',
        direction: 'LONG',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          marketFlushReversalContext: expect.objectContaining({
            signalDirection: 'LONG',
            marketFlushConfirmed: false,
            structureConfirmed: true,
          }),
        },
      }),
    );
  });

  it('skips MarketFlushReversal long entry outside the calibrated rebound pocket', async () => {
    const baseContext = makeBaseContext();
    const { strategyApi } = makeStrategyApi(101);
    const core = await createMarketFlushReversalCore(
      makeCoreParams({
        config: MFR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual({
      kind: 'skip',
      code: 'MFR_LONG_REBOUND_POCKET_MISSING',
    });
    expect(strategyApi.entry).not.toHaveBeenCalled();
  });

  it('keeps MarketFlushReversal short candidates available outside the long rebound pocket', async () => {
    const baseContext = makeShortMarketFlushBaseContext();
    const { strategyApi } = makeStrategyApi(101);
    const core = await createMarketFlushReversalCore(
      makeCoreParams({
        config: MFR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual(
      expect.objectContaining({
        kind: 'entry',
        code: 'MFR_SHORT_FLUSH_REVERSAL',
        direction: 'SHORT',
      }),
    );
    expect(strategyApi.entry).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalIndicators: {
          marketFlushReversalContext: expect.objectContaining({
            signalDirection: 'SHORT',
            marketPressure: 'short_flush',
            marketFlushConfirmed: true,
            structureConfirmed: true,
          }),
        },
      }),
    );
  });

  it('approves MarketFlushReversal gate on the validated risk-off oversold pocket', () => {
    const baseContext = makeCalibratedMarketFlushBaseContext();
    const context = buildMarketFlushReversalGuardrailContext({
      signalContext: {
        signalDirection: 'LONG',
        minMarketLiqSpikeRatio: 2,
        structureConfirmed: true,
        participationConfirmed: true,
        volumeRel20: 1.5,
        sweepWickPct: 0.4,
      },
      baseContext,
    });

    expect(context).toEqual(
      expect.objectContaining({
        approvalAllowedNow: true,
        deterministicQuality: 5,
        marketFlushConfirmed: true,
        approvalBlockReasons: [],
      }),
    );
    expect(context.marketFlushReversalGateFeatures).toEqual(
      expect.objectContaining({
        broadMarketPressure: 'long_flush',
        broadMarketFlushDirection: 'LONG',
        broadMarketFlushConfirmed: true,
        targetVsBtcRatioReturn24h: -3.3,
        ethVsBtcVolumeRatio: 0.54,
        calibratedLongRebound: true,
        stopDistanceAtr: 24,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: false,
        rsiState: 'oversold',
        validatedAiLongPocket: true,
      }),
    );
  });

  it('approves MarketFlushReversal gate through the H1 washout pocket without ETH/BTC volume', () => {
    const baseContext = makeCalibratedMarketFlushBaseContext();
    baseContext.relative.cmcReferenceAssets = undefined;
    baseContext.mtf.summary.h1RangePosition = 0.08;

    const context = buildMarketFlushReversalGuardrailContext({
      signalContext: {
        signalDirection: 'LONG',
        minMarketLiqSpikeRatio: 2,
        structureConfirmed: true,
        participationConfirmed: true,
      },
      baseContext,
    });

    expect(context).toEqual(
      expect.objectContaining({
        approvalAllowedNow: true,
        deterministicQuality: 5,
        approvalBlockReasons: [],
      }),
    );
    expect(context.marketFlushReversalGateFeatures).toEqual(
      expect.objectContaining({
        ethVsBtcVolumeRatio: null,
        h1RangePosition: 0.08,
        calibratedLongRebound: true,
      }),
    );
  });

  it('blocks MarketFlushReversal gate outside validated AI pocket boundaries', () => {
    const cases = [
      {
        stopDistanceAtr: 23.999,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: false,
        rsiState: 'oversold',
      },
      {
        stopDistanceAtr: 24,
        cmcIndexRegime: 'top20_led',
        cmcIndexStale: false,
        rsiState: 'oversold',
      },
      {
        stopDistanceAtr: 24,
        cmcIndexRegime: null,
        cmcIndexStale: false,
        rsiState: 'oversold',
      },
      {
        stopDistanceAtr: 24,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: null,
        rsiState: 'oversold',
      },
      {
        stopDistanceAtr: 24,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: false,
        rsiState: null,
      },
      {
        stopDistanceAtr: 24,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: true,
        rsiState: 'oversold',
      },
      {
        stopDistanceAtr: 24,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: false,
        rsiState: 'neutral',
      },
      {
        stopDistanceAtr: null,
        cmcIndexRegime: 'risk_off',
        cmcIndexStale: false,
        rsiState: 'oversold',
      },
    ];

    for (const item of cases) {
      const baseContext = makeCalibratedMarketFlushBaseContext();
      baseContext.gateFeatures.setup.stopDistanceAtr = item.stopDistanceAtr;
      baseContext.relative.cmcIndexes.indexRegime = item.cmcIndexRegime;
      baseContext.relative.cmcIndexes.stale = item.cmcIndexStale;
      baseContext.regime.momentum.rsiState = item.rsiState;

      const context = buildMarketFlushReversalGuardrailContext({
        signalContext: {
          signalDirection: 'LONG',
          minMarketLiqSpikeRatio: 2,
          structureConfirmed: true,
          participationConfirmed: true,
        },
        baseContext,
      });

      expect(context).toEqual(
        expect.objectContaining({
          approvalAllowedNow: false,
          deterministicQuality: 3,
          approvalBlockReasons: expect.arrayContaining([
            'validated_long_ai_pocket_missing',
          ]),
        }),
      );
      expect(context.marketFlushReversalGateFeatures).toEqual(
        expect.objectContaining({
          validatedAiLongPocket: false,
        }),
      );
    }
  });

  it('blocks MarketFlushReversal short approvals until a short pocket is validated', () => {
    const baseContext = makeCalibratedMarketFlushBaseContext();
    baseContext.derivatives.summary.pressure = 'short_flush';
    baseContext.derivatives.summary.riskFlags = ['short_liquidation_spike'];
    baseContext.derivatives.intervals['15m'].liqImbalance = 0.7;

    const context = buildMarketFlushReversalGuardrailContext({
      signalContext: {
        signalDirection: 'SHORT',
        minMarketLiqSpikeRatio: 2,
        structureConfirmed: true,
        participationConfirmed: true,
      },
      baseContext,
    });

    expect(context).toEqual(
      expect.objectContaining({
        approvalAllowedNow: false,
        deterministicQuality: 3,
        marketFlushConfirmed: true,
        approvalBlockReasons: expect.arrayContaining([
          'short_flush_rebound_pocket_not_validated',
        ]),
      }),
    );
  });

  it('keeps broad-market derivative outages as annotations for a validated pocket', () => {
    const baseContext = makeCalibratedMarketFlushBaseContext();
    baseContext.derivatives = undefined;
    const context = buildMarketFlushReversalGuardrailContext({
      signalContext: {
        signalDirection: 'LONG',
        minMarketLiqSpikeRatio: 2,
        structureConfirmed: true,
        participationConfirmed: true,
        volumeRel20: 1.5,
        sweepWickPct: 0.4,
      },
      baseContext,
    });

    expect(context).toEqual(
      expect.objectContaining({
        approvalAllowedNow: true,
        deterministicQuality: 5,
        marketFlushConfirmed: false,
        approvalBlockReasons: [],
        riskAnnotations: expect.arrayContaining([
          'missing_broad_market_derivatives',
        ]),
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
    baseContext.relative.targetVsBtc.ratioReturn1h = 4.2;
    baseContext.relative.targetVsBtc.ratioReturn24h = 1.2;
    baseContext.relative.targetVsBtc.alphaVsBtc24h = 4.2;
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

  it('uses target-vs-BTC 1h return for RelativeRotation strength', async () => {
    const baseContext = makeBaseContext();
    baseContext.relative.benchmark.relativeStrength1h = 10_000;
    baseContext.relative.targetVsBtc.ratioReturn1h = 0.1;
    const { strategyApi } = makeStrategyApi(101);
    const core = await createRelativeRotationCore(
      makeCoreParams({
        config: RR_DEFAULT_CONFIG,
        strategyApi,
        baseContext,
      }),
    );

    const result = await core(baseContext.candle, baseContext.candle);

    expect(result).toEqual({ kind: 'skip', code: 'NO_RELATIVE_ROTATION' });
  });
});
