import {
  buildBaseContextGateFeatures,
  buildStrategySignal,
} from '../signalBuilders';
import { BaseStrategyContextSnapshot } from '@tradejs/types';

const baseContext: BaseStrategyContextSnapshot = {
  candle: {
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
    turnover: 100000,
    timestamp: 1,
  },
  prevCandle: null,
  raw: {
    trend: { maFast: 100, maMedium: 99, maSlow: 98 },
    volatility: {
      atr: 1,
      atrPct: 1,
      bbUpper: 101,
      bbMiddle: 100,
      bbLower: 99,
      bbWidthPct: 2,
    },
    momentum: { macd: 1, macdSignal: 1, macdHistogram: 0 },
    volume: {
      volume: 1000,
      turnover: 100000,
      obv: 1,
      obvSma: 1,
      volume1h: 1000,
      volume24h: 4000,
    },
    price: {
      prevClose: 99,
      price1hPct: 1,
      price24hPct: 2,
      highPrice1h: 101,
      lowPrice1h: 98,
      highPrice24h: 105,
      lowPrice24h: 95,
    },
    levels: { highLevel: 101, lowLevel: 99 },
    crossAsset: { btcCorrelation: 0.5 },
  },
  regime: {
    trend: {
      bias: 'bull',
      maStackScore: 2,
      priceDistanceToMaFastAtr: 0,
      priceDistanceToMaSlowAtr: 2,
      persistence: 0.7,
    },
    volatility: {
      atrSlope: 0.2,
      atrPctZScore: 0.5,
      bbWidthPct: 2,
      compressionScore: 1,
      expansionScore: 1,
      state: 'normal',
    },
    momentum: {
      roc1h: 1,
      roc4h: 2,
      roc1d: 3,
      macdHistogramSlope: 0.1,
      bodyStrength: 0.5,
      closeLocationInRange: 0.5,
      upCloseStreak: 2,
      downCloseStreak: 0,
    },
    session: {
      sessionPhase: 'us',
      sessionWindowPhase: 'active',
      isOverlap: true,
      minutesFromSessionOpen: 90,
      minutesToSessionClose: 450,
      minutesToFundingWindow: 90,
      fundingWindowNearby: false,
      dayOfWeekUtc: 1,
      isWeekdayUtc: true,
      isWeekendUtc: false,
    },
    memory: {
      recentFalseBreakoutDensity: 0.1,
    },
  },
  structure: {
    localRange: {
      rangePosition20: 0.5,
      distanceToHighLevelAtr: -1,
      distanceToLowLevelAtr: 1,
      breakoutState: 'inside_range',
      barsSinceBreakout: null,
      breakoutRetestQuality: null,
    },
    levels: {
      highTouchCount20: 1,
      lowTouchCount20: 1,
      dominantTouchCount20: 1,
    },
    candleQuality: {
      upperWickPct: 0.2,
      lowerWickPct: 0.2,
      rejectionWickScore: 0.2,
    },
  },
  participation: {
    volume: {
      volumeRel20: 1,
      turnoverRel20: 1,
      volumeTrendSlope: 0.1,
      obvSlope: 0.1,
      effortVsResult: 2,
    },
  },
  relative: {
    benchmark: {
      maFast: 200,
      maSlow: 198,
      bias: 'bull',
      relativeStrength1h: 0.1,
      relativeStrength4h: 0.2,
      relativeStrength1d: 0.3,
      trendAlignment: 'aligned_bull',
    },
    execution: {
      venueSpread: 0.1,
      venueSpreadZScore: 0.2,
    },
  },
  mtf: {
    candles: { m15: [], h1: [], h4: [], d1: [] },
    benchmarkCandles: { m15: [], h1: [], h4: [], d1: [] },
  },
};

describe('buildStrategySignal', () => {
  it('derives gate features from Binance market context fields', () => {
    const signal = buildStrategySignal({
      signalId: 's-market',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 1,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
      indicators: {
        baseContext: {
          ...baseContext,
          participation: {
            ...baseContext.participation,
            hyperliquidWhales: {
              source: 'hyperliquid_trades',
              interval: '15m',
              asOfTs: 1,
              windowEndTs: 2,
              ageMs: 0,
              stale: false,
              symbol: 'BTC',
              trades: 3,
              whaleSides: 3,
              uniqueWhales: 2,
              coveredWhales: 90,
              expectedWhales: 100,
              coveragePct: 0.9,
              coverageSufficient: true,
              buyNotionalUsd: 800_000,
              sellNotionalUsd: 200_000,
              netNotionalUsd: 600_000,
              buySharePct: 0.8,
              positionAwareWhaleSides: 3,
              positionAwarePct: 1,
              longEntryWhales: 2,
              shortEntryWhales: 0,
              longExitWhales: 0,
              shortExitWhales: 0,
              longEntryNotionalUsd: 800_000,
              shortEntryNotionalUsd: 0,
              longExitNotionalUsd: 0,
              shortExitNotionalUsd: 0,
              entryNetNotionalUsd: 800_000,
              entryLongSharePct: 1,
              universeFingerprint: 'universe-v1',
              whaleRegistryFingerprint: 'whales-v1',
            },
            tradeFlow: {
              source: 'binance_agg_trades',
              interval: '15m',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              trades: 10,
              buyPressurePct: 0.7,
              buyBaseVolume: 7,
              sellBaseVolume: 3,
              buyQuoteVolume: 700,
              sellQuoteVolume: 300,
              netBaseDelta: 4,
              netQuoteDelta: 400,
            },
          },
          relative: {
            ...baseContext.relative,
            marketBreadth: {
              source: 'binance_klines',
              universe: 'binance_top30_usdt',
              interval: '15m',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              symbolsCount: 30,
              advancers: 20,
              decliners: 10,
              unchanged: 0,
              advanceDeclineRatio: 2,
              pctAboveMa20: 0.6,
              pctAboveMa50: 0.55,
              equalWeightedReturn: 0.01,
              volumeWeightedReturn: 0.02,
              dispersion: 0.03,
            },
          },
        },
      },
    });

    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures,
    ).toMatchObject({
      setup: {
        rewardToVolatility: 10,
        stopDistanceAtr: 5,
        tpDistanceAtr: 10,
        entryLocation: 'mid_range',
      },
      conflicts: {
        count: 0,
      },
      scores: {
        structure: 47,
        participation: 59,
        execution: 62,
        totalContext: 64,
      },
      risk: {
        liquidityRisk: 'low',
      },
      decisionHints: {
        approveBias: 'support',
        primaryIssue: 'none',
      },
      relative: {
        marketBreadthReturn: 0.01,
        marketBreadthStale: false,
      },
    });
    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures,
    ).not.toHaveProperty('confirmations');
    const gateFeatures = signal.additionalIndicators?.baseContext?.gateFeatures;
    expect(Object.keys(gateFeatures ?? {}).sort()).toEqual(
      [
        'conflicts',
        'decisionHints',
        'mtf',
        'participation',
        'relative',
        'risk',
        'scores',
        'setup',
        'volatility',
      ].sort(),
    );
    expect(gateFeatures).not.toHaveProperty('direction');
    expect(gateFeatures).not.toHaveProperty('structure');
    expect(gateFeatures).not.toHaveProperty('execution');
    expect(gateFeatures?.scores).not.toHaveProperty('relative');
    expect(gateFeatures?.scores).not.toHaveProperty('mtf');
    expect(gateFeatures?.scores).not.toHaveProperty('derivatives');
    expect(gateFeatures?.conflicts).not.toHaveProperty('items');
    expect(gateFeatures?.decisionHints).not.toHaveProperty(
      'maxReasonableQuality',
    );
  });

  it('keeps insufficient Hyperliquid coverage out of AI-gate flow features', () => {
    const gateFeatures = buildBaseContextGateFeatures({
      baseContext: {
        ...baseContext,
        participation: {
          ...baseContext.participation,
          hyperliquidWhales: {
            source: 'hyperliquid_trades',
            interval: '15m',
            asOfTs: 1,
            windowEndTs: 2,
            ageMs: 0,
            stale: false,
            symbol: 'BTC',
            trades: 3,
            whaleSides: 3,
            uniqueWhales: 2,
            coveredWhales: 40,
            expectedWhales: 100,
            coveragePct: 0.4,
            coverageSufficient: false,
            buyNotionalUsd: 800_000,
            sellNotionalUsd: 200_000,
            netNotionalUsd: 600_000,
            buySharePct: 0.8,
            positionAwareWhaleSides: 3,
            positionAwarePct: 1,
            longEntryWhales: 2,
            shortEntryWhales: 0,
            longExitWhales: 0,
            shortExitWhales: 0,
            longEntryNotionalUsd: 800_000,
            shortEntryNotionalUsd: 0,
            longExitNotionalUsd: 0,
            shortExitNotionalUsd: 0,
            entryNetNotionalUsd: 800_000,
            entryLongSharePct: 1,
            universeFingerprint: 'universe-v1',
            whaleRegistryFingerprint: 'whales-v1',
          },
        },
      },
      direction: 'LONG',
    });

    expect(gateFeatures.scores?.participation).toBe(35);
    expect(gateFeatures.participation).toEqual({
      volumeStructureAligned: null,
    });
  });

  it('derives BTC/ETH-relative gate features from target and alt-basket context', () => {
    const signal = buildStrategySignal({
      signalId: 's-relative-btc',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 1,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
      indicators: {
        baseContext: {
          ...baseContext,
          relative: {
            ...baseContext.relative,
            targetVsBtc: {
              source: 'aligned_ohlcv',
              ratioReturn1h: 0.5,
              ratioReturn4h: 1.2,
              ratioReturn24h: 2.5,
              alphaVsBtc1h: 0.5,
              alphaVsBtc4h: 1.2,
              alphaVsBtc24h: 2.5,
              betaToBtc20: 1.1,
              correlationToBtc20: 0.8,
              ratioTrend: 'up',
            },
            targetVsEth: {
              source: 'aligned_ohlcv',
              ratioReturn1h: 0.4,
              ratioReturn4h: 1.1,
              ratioReturn24h: 2.2,
              alphaVsEth1h: 0.4,
              alphaVsEth4h: 1.1,
              alphaVsEth24h: 2.2,
              betaToEth20: 1.05,
              correlationToEth20: 0.75,
              ratioTrend: 'up',
            },
            btcAltRegime: {
              source: 'binance_klines',
              universe: 'binance_top30_usdt',
              interval: '15m',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              btcReturn1h: 0.001,
              btcReturn4h: 0.002,
              btcReturn24h: 0.01,
              altBasketReturn1h: 0.002,
              altBasketReturn4h: 0.004,
              altBasketReturn24h: 0.03,
              btcVsAltReturn1h: -0.001,
              btcVsAltReturn4h: -0.002,
              btcVsAltReturn24h: -0.02,
              btcTurnoverShare1h: 0.4,
              btcTurnoverShare24h: 0.35,
              btcTurnoverShareChange24h: -0.05,
              altVolToBtcVol24h: 1.8,
              altDispersion24h: 0.02,
              regime: 'risk_on',
            },
          },
        },
      },
    });

    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures,
    ).toMatchObject({
      relative: {
        btcAltRegime: 'risk_on',
        btcAltRegimeStale: false,
        btcVsAltReturn24h: -0.02,
      },
    });
    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures?.relative,
    ).not.toHaveProperty('targetVsBtcRatioReturn24h');
  });

  it('derives CMC exchange liquidity and fear-greed gate features', () => {
    const signal = buildStrategySignal({
      signalId: 's-cmc-context',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 1,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
      indicators: {
        baseContext: {
          ...baseContext,
          relative: {
            ...baseContext.relative,
            cmcExchangeLiquidity: {
              source: 'coinmarketcap_exchange_liquidity',
              interval: '1d',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              exchangesCount: 5,
              totalVolumeUsd: 80_000_000_000,
              totalVolumeChange24hPct: 0.18,
              binanceVolumeUsd: 36_000_000_000,
              binanceVolumeShare: 0.45,
              topExchangeVolumeShare: 0.45,
              liquidityRegime: 'expanding',
            },
            cmcFearGreed: {
              source: 'coinmarketcap_fear_greed',
              interval: '1d',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              value: 62,
              valueChange24h: 8,
              valueChange7d: 15,
              classification: 'Greed',
              sentimentRegime: 'risk_on',
            },
            cmcIndexes: {
              source: 'coinmarketcap_index',
              interval: '1d',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              cmc100Value: 240,
              cmc100Change24hPct: 0.01,
              cmc100TopConstituentSymbol: 'BTC',
              cmc100TopConstituentWeightPct: 64.2,
              cmc20Value: 260,
              cmc20Change24hPct: 0.024,
              cmc20TopConstituentSymbol: 'BTC',
              cmc20TopConstituentWeightPct: 72.4,
              cmc20ToCmc100Ratio: 260 / 240,
              cmc20ToCmc100RatioChange24hPct: 0.01386138613861387,
              indexRegime: 'top20_led',
            },
          },
        },
      },
    });

    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures,
    ).toMatchObject({
      relative: {
        cmcExchangeLiquidityAligned: true,
        cmcExchangeLiquidityStale: false,
        cmcExchangeLiquidityVolumeChange24hPct: 0.18,
        cmcFearGreedValue: 62,
        cmcFearGreedValueChange24h: 8,
        cmcFearGreedStale: false,
        cmc20ToCmc100RatioChange24hPct: 0.01386138613861387,
      },
      risk: {
        liquidityRisk: 'low',
      },
    });
  });

  it('turns conflicting normalized context into reject-oriented gate hints', () => {
    const signal = buildStrategySignal({
      signalId: 's-conflict',
      strategy: 'TrendLine',
      symbol: 'SOLUSDT',
      interval: '15' as any,
      direction: 'SHORT',
      timestamp: 1,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 90,
        stopLossPrice: 105,
        riskRatio: 2,
      },
      indicators: {
        baseContext: {
          ...baseContext,
          mtf: {
            ...baseContext.mtf,
            summary: {
              h1TrendBias: 'bull',
              h4TrendBias: 'bull',
              d1TrendBias: 'neutral',
              h1RangePosition: 0.8,
              h4VolatilityState: 'expanded',
              mtfAlignment: 'aligned_bull',
            },
          },
          regime: {
            ...baseContext.regime,
            volatility: {
              ...baseContext.regime.volatility,
              atrPctZScore: 2.5,
            },
          },
          participation: {
            ...baseContext.participation,
            delta: {
              buyPressurePct: 0.8,
              sellPressurePct: 0.2,
              deltaDivergenceVsPrice: 'none',
            },
            tradeFlow: {
              source: 'binance_agg_trades',
              interval: '15m',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              trades: 10,
              buyPressurePct: 0.8,
              buyBaseVolume: 8,
              sellBaseVolume: 2,
              buyQuoteVolume: 800,
              sellQuoteVolume: 200,
              netBaseDelta: 6,
              netQuoteDelta: 600,
            },
          },
          relative: {
            ...baseContext.relative,
            benchmark: {
              ...baseContext.relative.benchmark,
              trendAlignment: 'aligned_bull',
              relativeStrength1h: 2,
            },
            marketBreadth: {
              source: 'binance_klines',
              universe: 'binance_top30_usdt',
              interval: '15m',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              symbolsCount: 30,
              advancers: 24,
              decliners: 6,
              unchanged: 0,
              advanceDeclineRatio: 4,
              pctAboveMa20: 0.8,
              pctAboveMa50: 0.7,
              equalWeightedReturn: 0.03,
              volumeWeightedReturn: 0.04,
              dispersion: 0.02,
            },
            cmcIndexes: {
              source: 'coinmarketcap_index',
              interval: '1d',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              cmc100Value: 240,
              cmc100Change24hPct: 0.01,
              cmc100TopConstituentSymbol: 'BTC',
              cmc100TopConstituentWeightPct: 64.2,
              cmc20Value: 260,
              cmc20Change24hPct: 0.024,
              cmc20TopConstituentSymbol: 'BTC',
              cmc20TopConstituentWeightPct: 72.4,
              cmc20ToCmc100Ratio: 260 / 240,
              cmc20ToCmc100RatioChange24hPct: 0.01386138613861387,
              indexRegime: 'top20_led',
            },
            targetVsEth: {
              source: 'aligned_ohlcv',
              ratioReturn1h: 0.5,
              ratioReturn4h: 1.5,
              ratioReturn24h: 3,
              alphaVsEth1h: 0.5,
              alphaVsEth4h: 1.5,
              alphaVsEth24h: 3,
              betaToEth20: 1.2,
              correlationToEth20: 0.9,
              ratioTrend: 'up',
            },
            execution: {
              ...baseContext.relative.execution,
              venueSpreadZScore: 2.5,
            },
          },
          derivatives: {
            source: 'coinalyze',
            symbol: 'BTCUSDT',
            targetSymbol: 'SOLUSDT',
            timestamp: 1,
            intervals: {},
            summary: {
              pressure: 'crowded_short',
              directionAligned: false,
              riskFlags: ['crowded_short'],
            },
          },
        },
      },
    });

    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures,
    ).toMatchObject({
      mtf: {
        higherTimeframeConflict: true,
      },
      conflicts: {
        count: 12,
      },
      risk: {
        liquidityRisk: 'high',
      },
      decisionHints: {
        approveBias: 'reject',
        primaryIssue: 'crowded_derivatives',
      },
    });
  });

  it('copies baseContext from indicators into additionalIndicators', () => {
    const signal = buildStrategySignal({
      signalId: 's1',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 1,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
      indicators: {
        baseContext,
        maFast: [100],
      },
      additionalIndicators: {
        touches: 3,
      },
    });

    expect(signal.additionalIndicators?.touches).toBe(3);
    expect(signal.additionalIndicators?.baseContext).toMatchObject({
      ...baseContext,
      mtf: {
        compact: true,
        candles: baseContext.mtf.candles,
        benchmarkCandles: baseContext.mtf.benchmarkCandles,
      },
      gateFeatures: expect.objectContaining({
        relative: expect.objectContaining({
          benchmarkConflict: false,
        }),
      }),
    });
    expect(signal.indicators).toEqual({
      maFast: [100],
    });
  });

  it('copies compact baseContext mtf data by evaluating lazy mtf getters once', () => {
    let mtfGetterCalls = 0;
    const liveBaseContext = {
      raw: {
        trend: {
          maFast: 100,
        },
      },
      regime: {
        session: {
          sessionPhase: 'us',
        },
      },
      get mtf() {
        mtfGetterCalls += 1;
        return {
          candles: {
            m15: [
              { close: 100, timestamp: 0 },
              { close: 101, timestamp: 1 },
              { close: 102, timestamp: 2 },
              { close: 103, timestamp: 3 },
            ],
            h1: [],
            h4: [],
            d1: [],
          },
          benchmarkCandles: {
            m15: [],
            h1: [],
            h4: [],
            d1: [],
          },
          summary: {
            h1TrendBias: 'bear',
            h4TrendBias: 'bear',
            d1TrendBias: 'neutral',
            h1RangePosition: 0.25,
            h4VolatilityState: 'normal',
            mtfAlignment: 'aligned_bear',
          },
        };
      },
    } as unknown as BaseStrategyContextSnapshot;

    const signal = buildStrategySignal({
      signalId: 's2',
      strategy: 'TrendShift',
      symbol: 'ETHUSDT',
      interval: '15' as any,
      direction: 'SHORT',
      timestamp: 2,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 90,
        stopLossPrice: 105,
        riskRatio: 2,
      },
      indicators: {
        baseContext: liveBaseContext,
      },
    });

    expect(mtfGetterCalls).toBe(1);
    expect(signal.additionalIndicators?.baseContext).not.toBe(liveBaseContext);
    expect(signal.additionalIndicators?.baseContext).toMatchObject({
      raw: {
        trend: {
          maFast: 100,
        },
      },
      regime: {
        session: {
          sessionPhase: 'us',
        },
      },
      mtf: {
        compact: true,
        candles: {
          m15: [
            { close: 101, timestamp: 1 },
            { close: 102, timestamp: 2 },
            { close: 103, timestamp: 3 },
          ],
        },
        summary: {
          mtfAlignment: 'aligned_bear',
        },
      },
      gateFeatures: {
        mtf: expect.objectContaining({
          higherTimeframeConflict: false,
        }),
      },
    });
  });

  it('materializes lazy baseContext sections once when building a signal', () => {
    const reads = {
      regime: 0,
      structure: 0,
      participation: 0,
      relative: 0,
      mtf: 0,
    };
    const participationReads = {
      priceVolumeProfile: 0,
      volumeStructure: 0,
      delta: 0,
    };
    const lazyParticipation = {
      volume: baseContext.participation.volume,
      get priceVolumeProfile() {
        participationReads.priceVolumeProfile += 1;
        return {
          pointOfControl: 100,
          distanceToPointOfControlAtr: 0,
          pointOfControlVolumeShare: 0.2,
          priceAbovePointOfControl: false,
          nearPointOfControl: true,
        };
      },
      get volumeStructure() {
        participationReads.volumeStructure += 1;
        return {
          pointOfControl: 100,
          pocIndex: 10,
          pointOfControlVolumeShare: 0.2,
          pocUpVolumeShare: 0.6,
          pocDownVolumeShare: 0.4,
          totalUpVolumeShare: 0.55,
          totalDownVolumeShare: 0.45,
          priceAbovePointOfControl: false,
          distanceToPointOfControlAtr: 0,
          rowCount: 20,
          calcBars: 180,
        };
      },
      get delta() {
        participationReads.delta += 1;
        return {
          buyPressurePct: 0.55,
          signedVolume: 10,
          signedVolumeZScore: 0.2,
          deltaSlope: 0.1,
          deltaDivergenceVsPrice: 'none' as const,
        };
      },
    } as BaseStrategyContextSnapshot['participation'];
    const liveBaseContext = {
      candle: baseContext.candle,
      prevCandle: baseContext.prevCandle,
      raw: baseContext.raw,
      get regime() {
        reads.regime += 1;
        return baseContext.regime;
      },
      get structure() {
        reads.structure += 1;
        return baseContext.structure;
      },
      get participation() {
        reads.participation += 1;
        return lazyParticipation;
      },
      get relative() {
        reads.relative += 1;
        return baseContext.relative;
      },
      get mtf() {
        reads.mtf += 1;
        return baseContext.mtf;
      },
    } as BaseStrategyContextSnapshot;

    const signal = buildStrategySignal({
      signalId: 's-lazy-context',
      strategy: 'RelativeRotation',
      symbol: 'ETHUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 4,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
      indicators: {
        baseContext: liveBaseContext,
      },
    });

    expect(reads).toEqual({
      regime: 1,
      structure: 1,
      participation: 1,
      relative: 1,
      mtf: 1,
    });
    expect(participationReads).toEqual({
      priceVolumeProfile: 1,
      volumeStructure: 1,
      delta: 1,
    });
    expect(signal.additionalIndicators?.baseContext).toMatchObject({
      regime: baseContext.regime,
      structure: baseContext.structure,
      participation: {
        volume: baseContext.participation.volume,
        priceVolumeProfile: {
          pointOfControl: 100,
        },
        volumeStructure: {
          pointOfControl: 100,
        },
        delta: {
          signedVolume: 10,
        },
      },
      relative: baseContext.relative,
      mtf: {
        compact: true,
      },
    });
  });

  it('does not materialize lazy indicator snapshot fields when moving baseContext', () => {
    let lazyReads = 0;
    const indicators = new Proxy(
      {
        baseContext,
        maFast: [98, 99, 100],
      },
      {
        ownKeys(target) {
          return [...Reflect.ownKeys(target), 'maFast1h'];
        },
        getOwnPropertyDescriptor(target, prop) {
          if (prop === 'maFast1h') {
            return {
              enumerable: true,
              configurable: true,
            };
          }

          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
        get(target, prop, receiver) {
          if (prop === 'maFast1h') {
            lazyReads += 1;
            return [1, 2, 3];
          }

          return Reflect.get(target, prop, receiver);
        },
      },
    ) as unknown as Record<string, unknown>;

    const signal = buildStrategySignal({
      signalId: 's3',
      strategy: 'AdaptiveTrendChannel',
      symbol: 'ETHUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 3,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
      indicators,
    });

    expect(lazyReads).toBe(0);
    expect(signal.indicators).toEqual({
      maFast: [98, 99, 100],
    });
    expect(signal.additionalIndicators?.baseContext).toMatchObject({
      raw: {
        trend: {
          maFast: 100,
        },
      },
      gateFeatures: expect.objectContaining({
        setup: expect.objectContaining({
          rewardToVolatility: 10,
        }),
      }),
    });
  });
});
