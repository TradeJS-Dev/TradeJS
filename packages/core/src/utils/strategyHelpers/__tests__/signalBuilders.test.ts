import { buildStrategySignal } from '../signalBuilders';
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
        riskRatio: 2,
        rewardToVolatility: 10,
        stopDistanceAtr: 5,
        tpDistanceAtr: 10,
        entryLocation: 'mid_range',
      },
      confirmations: {
        count: 3,
        items: [
          'trade_flow_aligned',
          'market_breadth_aligned',
          'benchmark_aligned',
        ],
      },
      conflicts: {
        count: 0,
        items: [],
      },
      scores: {
        structure: 47,
        participation: 47,
        relative: 86,
        mtf: null,
        execution: 62,
        derivatives: null,
        totalContext: 61,
      },
      risk: {
        regimeRisk: 'medium',
        liquidityRisk: 'low',
        volatilityRisk: 'unknown',
        crowdingRisk: 'unknown',
        chaseRisk: 'low',
      },
      decisionHints: {
        approveBias: 'support',
        maxReasonableQuality: 5,
        needsExtraConfirmation: false,
        primaryIssue: 'none',
      },
      participation: {
        tradeFlowBuyPressurePct: 0.7,
        tradeFlowAligned: true,
      },
      relative: {
        marketBreadthReturn: 0.01,
        marketBreadthAligned: true,
        marketBreadthStale: false,
      },
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
      confirmations: {
        items: expect.arrayContaining([
          'target_vs_btc_aligned',
          'target_vs_eth_aligned',
          'btc_alt_regime_aligned',
        ]),
      },
      relative: {
        targetVsBtcRatioReturn24h: 2.5,
        targetVsBtcAlpha24h: 2.5,
        targetVsBtcBeta20: 1.1,
        targetVsBtcCorrelation20: 0.8,
        targetVsBtcRatioTrend: 'up',
        targetVsBtcAligned: true,
        targetVsEthRatioReturn24h: 2.2,
        targetVsEthAlpha24h: 2.2,
        targetVsEthBeta20: 1.05,
        targetVsEthCorrelation20: 0.75,
        targetVsEthRatioTrend: 'up',
        targetVsEthAligned: true,
        btcAltRegime: 'risk_on',
        btcAltRegimeAligned: true,
        btcAltRegimeStale: false,
        btcVsAltReturn24h: -0.02,
        btcTurnoverShare24h: 0.35,
      },
    });
  });

  it('derives CMC breadth and exchange liquidity gate features', () => {
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
            cmcMarketBreadth: {
              source: 'coinmarketcap_market_breadth',
              universe: 'cmc_top100',
              interval: '1d',
              asOfTs: 1,
              ageMs: 0,
              stale: false,
              topAssetsCount: 100,
              assetsCount: 100,
              positive24hPct: 0.68,
              positive7dPct: 0.61,
              avgReturn24hPct: 0.018,
              medianReturn24hPct: 0.012,
              avgReturn7dPct: 0.04,
              medianReturn7dPct: 0.031,
              returnDispersion24hPct: 0.04,
              returnDispersion7dPct: 0.07,
              top10MarketCapShare: 0.72,
              top25MarketCapShare: 0.84,
              btcMarketCapShare: 0.48,
              ethMarketCapShare: 0.16,
              btcEthMarketCapShare: 0.64,
              stablecoinMarketCapShare: 0.09,
              stablecoinVolumeShare: 0.18,
              totalMarketCapUsd: 2_600_000_000_000,
              totalVolumeUsd: 120_000_000_000,
              breadthRegime: 'risk_on',
            },
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
          },
        },
      },
    });

    expect(
      signal.additionalIndicators?.baseContext?.gateFeatures,
    ).toMatchObject({
      confirmations: {
        items: expect.arrayContaining([
          'cmc_market_breadth_aligned',
          'cmc_exchange_liquidity_aligned',
        ]),
      },
      relative: {
        cmcMarketBreadthRegime: 'risk_on',
        cmcMarketBreadthAligned: true,
        cmcMarketBreadthStale: false,
        cmcMarketBreadthPositive24hPct: 0.68,
        cmcExchangeLiquidityRegime: 'expanding',
        cmcExchangeLiquidityAligned: true,
        cmcExchangeLiquidityStale: false,
        cmcExchangeLiquidityVolumeChange24hPct: 0.18,
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
        alignmentForDirection: 'against',
        higherTimeframeConflict: true,
      },
      conflicts: {
        items: expect.arrayContaining([
          'mtf_against',
          'benchmark_against',
          'relative_strength_against',
          'market_breadth_against',
          'target_vs_eth_against',
          'delta_against',
          'trade_flow_against',
          'extreme_volatility',
          'wide_spread',
          'derivatives_against',
          'derivatives_crowded',
        ]),
      },
      risk: {
        regimeRisk: 'high',
        liquidityRisk: 'high',
        volatilityRisk: 'high',
        crowdingRisk: 'high',
      },
      decisionHints: {
        approveBias: 'reject',
        maxReasonableQuality: 2,
        needsExtraConfirmation: true,
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
        direction: 'LONG',
        mtf: expect.objectContaining({
          alignmentForDirection: 'unknown',
        }),
        relative: expect.objectContaining({
          benchmarkAligned: true,
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
        direction: 'SHORT',
        mtf: expect.objectContaining({
          alignmentForDirection: 'aligned',
          higherTimeframeConflict: false,
        }),
      },
    });
  });
});
