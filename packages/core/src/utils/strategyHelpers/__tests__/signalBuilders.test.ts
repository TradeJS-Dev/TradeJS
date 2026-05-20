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
      isOverlap: true,
      minutesFromSessionOpen: 90,
      minutesToFundingWindow: 90,
      fundingWindowNearby: false,
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
    expect(signal.additionalIndicators?.baseContext).toEqual(baseContext);
    expect(signal.indicators).toEqual({
      maFast: [100],
    });
  });
});
