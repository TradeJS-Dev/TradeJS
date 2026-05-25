import { Candle } from '@tradejs/types';
import {
  buildIndicatorCacheSnapshots,
  createIndicators,
  getRequiredControllerSeedWindow,
} from '../indicators';
import { buildBaseContextMtfSnapshot } from '../indicatorBaseContext';
import { CORRELATION_WINDOW, ML_BASE_CANDLES_WINDOW } from '../../constants';
import { calculateCoinBtcCorrelation } from '../correlation';
import { buildDefaultIndicatorPeriods } from '../strategyHelpers/indicators';

const INTERVAL_15M_MS = 15 * 60_000;

const makeCandle = (
  timestamp: number,
  close: number,
  high = close,
  low = close,
  volume = 1000,
): Candle => ({
  timestamp,
  open: close,
  high,
  low,
  close,
  volume,
  turnover: close * volume,
});

const percentChange = (current: number, previous: number): number | null => {
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return null;
  }

  return ((current - previous) / previous) * 100;
};

describe('utils indicators', () => {
  it('ignores undefined strategy period overrides and preserves defaults', () => {
    const periods = buildDefaultIndicatorPeriods({
      MA_FAST: undefined,
      ATR: 14,
      LEVEL_DELAY: 0,
    });

    expect(periods).toEqual({
      atr: 14,
      levelDelay: 0,
    });

    expect(() => createIndicators([], [], { periods })).not.toThrow();
  });

  it('derives controller seed window from the largest raw-history dependency', () => {
    expect(getRequiredControllerSeedWindow()).toBe(200);
    expect(
      getRequiredControllerSeedWindow({
        levelLookback: 150,
        levelDelay: 10,
      }),
    ).toBe(200);
  });

  it('computes price1hPcnt and price24hPcnt when window is full', () => {
    const indicators = createIndicators([]);
    const results: Array<ReturnType<typeof indicators.next> | null> = [];

    const baseClose = 100;
    for (let i = 0; i < 100; i += 1) {
      const candle = makeCandle(i * INTERVAL_15M_MS, baseClose + i);
      results.push(indicators.next(candle));
    }

    const idx24h = 96;
    const res24h = results[idx24h];
    expect(res24h).toBeTruthy();
    expect(res24h?.price24hPcnt).not.toBeNull();
    expect(res24h?.price1hPcnt).not.toBeNull();

    const expectedPrice24h =
      ((baseClose + idx24h - baseClose) / baseClose) * 100;
    expect(res24h?.price24hPcnt).toBeCloseTo(expectedPrice24h, 6);

    const idx1hStart = idx24h - 4;
    const expectedPrice1h =
      ((baseClose + idx24h - (baseClose + idx1hStart)) /
        (baseClose + idx1hStart)) *
      100;
    expect(res24h?.price1hPcnt).toBeCloseTo(expectedPrice1h, 6);
  });

  it('computes breakout levels and prevCandle in indicator snapshot', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
        levelLookback: 3,
        levelDelay: 1,
      },
    });

    let last: ReturnType<typeof indicators.next> | null = null;
    for (let i = 0; i < 8; i += 1) {
      const close = 100 + i;
      const high = 10 + i;
      const low = 1 + i;
      last = indicators.next(makeCandle(i * INTERVAL_15M_MS, close, high, low));
    }

    expect(last).toBeTruthy();
    expect(last?.prevCandle?.close).toBe(106);
    expect(last?.highLevel).toBe(16);
    expect(last?.lowLevel).toBe(5);
    expect(last?.baseContext?.regime.trend.bias).toBeDefined();
    expect(last?.baseContext?.regime.session.sessionPhase).toBeDefined();
    expect(last?.baseContext?.regime.volatility.atrSlope).toBeDefined();
    expect(
      last?.baseContext?.regime.memory.recentFalseBreakoutDensity,
    ).toBeDefined();
    expect(last?.baseContext?.raw.levels.highLevel).toBe(16);
    expect(
      last?.baseContext?.structure.localRange.barsSinceBreakout,
    ).toBeNull();
    expect(
      last?.baseContext?.structure.levels.dominantTouchCount20 ?? 0,
    ).toBeGreaterThan(0);
  });

  it('derives deterministic structure zones, liquidity sweep, and volume profile context', () => {
    const periods = {
      maFast: 3,
      maMedium: 5,
      maSlow: 8,
      obvSma: 3,
      atr: 5,
      atrPctShort: 3,
      atrPctLong: 8,
      bb: 8,
      bbStd: 2,
      macdFast: 3,
      macdSlow: 6,
      macdSignal: 3,
    };
    const pattern = [
      { close: 100, high: 101, low: 99, volume: 900 },
      { close: 111, high: 113, low: 109, volume: 1000 },
      { close: 105, high: 106, low: 104, volume: 5000 },
      { close: 96, high: 98, low: 94, volume: 1100 },
      { close: 104, high: 105, low: 103, volume: 5200 },
      { close: 112, high: 114, low: 110, volume: 1000 },
      { close: 106, high: 107, low: 105, volume: 4800 },
      { close: 95, high: 97, low: 93, volume: 1200 },
      { close: 105, high: 106, low: 104, volume: 5300 },
      { close: 110, high: 112, low: 108, volume: 1000 },
    ];
    const candles = Array.from({ length: 90 }, (_, index) => {
      const item = pattern[index % pattern.length];
      return makeCandle(
        index * INTERVAL_15M_MS,
        item.close,
        item.high,
        item.low,
        item.volume,
      );
    });
    candles.push({
      ...makeCandle(90 * INTERVAL_15M_MS, 110, 121, 109, 1800),
      open: 113,
    });

    const first = createIndicators([], [], { periods });
    const second = createIndicators([], [], { periods });

    candles.forEach((candle) => {
      first.next(candle);
      second.next(candle);
    });

    const context = first.snapshot().baseContext;
    expect(context?.structure.zones?.support.level).toBeGreaterThan(90);
    expect(context?.structure.zones?.support.level).toBeLessThan(100);
    expect(context?.structure.zones?.resistance.level).toBeGreaterThan(108);
    expect(context?.structure.zones?.resistance.level).toBeLessThan(115);
    expect(context?.structure.zones?.support.touches ?? 0).toBeGreaterThan(2);
    expect(context?.structure.zones?.resistance.touches ?? 0).toBeGreaterThan(
      2,
    );
    expect(context?.structure.liquidity?.sweepState).toBe('swept_high');
    expect(context?.structure.liquidity?.side).toBe('high');
    expect(context?.structure.liquidity?.referenceZoneSide).toBe('resistance');
    expect(context?.structure.liquidity?.sweepHigh20).toBe(true);
    expect(context?.structure.liquidity?.closeBackInsideRange).toBe(true);
    expect(context?.structure.liquidity?.stopRunDirection).toBe('up');
    expect(context?.structure.liquidity?.sweepWickPct ?? 0).toBeGreaterThan(0);
    expect(context?.structure.pivots?.lastSwingHigh).toBeGreaterThan(108);
    expect(context?.structure.pivots?.lastSwingLow).toBeLessThan(100);
    expect(context?.structure.pivots?.swingAmplitudeAtr ?? 0).toBeGreaterThan(
      0,
    );
    expect(context?.structure.pivots?.pivotDensity20 ?? 0).toBeGreaterThan(0);
    expect(context?.structure.acceptance?.breakoutBodyAtr ?? 0).toBeGreaterThan(
      0,
    );
    expect(
      context?.structure.zones?.resistance.volumeShare ?? 0,
    ).toBeGreaterThan(0);
    expect(
      context?.participation.priceVolumeProfile?.pointOfControl,
    ).toBeGreaterThan(102);
    expect(
      context?.participation.priceVolumeProfile?.pointOfControl,
    ).toBeLessThan(108);
    expect(
      context?.participation.priceVolumeProfile?.pointOfControlVolumeShare ?? 0,
    ).toBeGreaterThan(0.15);
    expect(context?.participation.delta?.buyPressurePct).toBeLessThan(0.2);
    expect(context?.participation.delta?.signedVolume).toBeDefined();
    expect(context?.participation.delta?.deltaDivergenceVsPrice).not.toBe(
      'unknown',
    );
    expect(first.snapshot().baseContext).toEqual(second.snapshot().baseContext);
  });

  it('uses Binance kline taker buy volume for participation delta when available', () => {
    const indicators = createIndicators([], [], {
      periods: buildDefaultIndicatorPeriods({ ATR: 3 }),
    });

    [
      makeCandle(0, 100, 102, 98, 10),
      makeCandle(INTERVAL_15M_MS, 101, 103, 99, 10),
      makeCandle(INTERVAL_15M_MS * 2, 102, 104, 100, 10),
      {
        ...makeCandle(INTERVAL_15M_MS * 3, 103, 105, 101, 10),
        takerBuyBaseVolume: 8,
        takerSellBaseVolume: 2,
        takerBuyQuoteVolume: 824,
        takerSellQuoteVolume: 206,
      },
    ].forEach((candle) => indicators.next(candle));

    const delta = indicators.snapshot().baseContext?.participation.delta;

    expect(delta).toMatchObject({
      source: 'kline_taker_volume',
      buyPressurePct: 0.8,
      buyVolume: 8,
      sellVolume: 2,
      netDelta: 6,
      deltaPct: 0.6,
      signedVolume: 6,
    });
  });

  it('derives layered trend, context boundary, and adaptive channel from trend history', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 5,
        maMedium: 13,
        maSlow: 34,
        obvSma: 5,
        atr: 14,
        atrPctShort: 5,
        atrPctLong: 14,
        bb: 20,
        bbStd: 2,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
      },
    });

    for (let i = 0; i < 230; i += 1) {
      const close = 100 + i * 0.4;
      indicators.next(
        makeCandle(i * INTERVAL_15M_MS, close, close + 1.5, close - 1.5),
      );
    }

    const context = indicators.snapshot().baseContext;
    const trend = context?.regime.trend;
    expect(trend?.maLayers?.bullishLayerCount).toBe(5);
    expect(trend?.maLayers?.bearishLayerCount).toBe(0);
    expect(trend?.maLayers?.alignment).toBe('bull');
    expect(trend?.adx?.direction).toBe('bull');
    expect(trend?.adx?.strength).toBe('strong');
    expect(trend?.adx?.diPlus ?? 0).toBeGreaterThan(trend?.adx?.diMinus ?? 0);
    expect(trend?.maLayers?.fastImpulseBias).toBe('bull');
    expect(trend?.maLayers?.macroBias).toBe('bull');
    expect(trend?.maLayers?.layerConflict).toBe(false);
    expect(trend?.contextMa?.contextBias).toBe('bull');
    expect(trend?.contextMa?.distanceToBoundaryAtr ?? 0).toBeGreaterThan(0);
    expect(trend?.adaptiveChannel?.direction).toBe('bull');
    expect(trend?.adaptiveChannel?.centerlineSlope ?? 0).toBeGreaterThan(0);
    expect(trend?.adaptiveChannel?.channelWidthAtr).toBeCloseTo(3, 6);
    expect(trend?.adaptiveChannel?.pricePositionInChannel ?? 0).toBeGreaterThan(
      0.5,
    );
    expect(context?.regime.momentum.rsi).toBeGreaterThan(70);
    expect(context?.regime.momentum.rsiState).toBe('overbought');
    expect(
      context?.regime.volatility.percentiles?.atrPctRank100,
    ).toBeGreaterThan(0);
    expect(
      context?.regime.volatility.percentiles?.rangeExpansionRank20,
    ).toBeGreaterThan(0);
  });

  it('keeps baseContext RSI and ADX calculations stable', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 5,
        maMedium: 10,
        maSlow: 20,
        atr: 14,
        atrPctShort: 7,
        atrPctLong: 30,
        bb: 20,
        bbStd: 2,
        obvSma: 10,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
      },
    });

    for (let i = 0; i < 230; i += 1) {
      const close =
        100 + Math.sin(i / 4) * 5 + Math.cos(i / 9) * 2 + ((i % 13) - 6) * 0.12;
      indicators.next(
        makeCandle(
          i * INTERVAL_15M_MS,
          close,
          close + 1.1 + (i % 4) * 0.17,
          close - 1.0 - (i % 5) * 0.13,
        ),
      );
    }

    const context = indicators.snapshot().baseContext;

    expect(context?.regime.momentum.rsi).toBeCloseTo(70.93, 12);
    expect(context?.regime.momentum.rsiState).toBe('overbought');
    expect(context?.regime.trend.adx?.adx).toBeCloseTo(23.07381929824377, 12);
    expect(context?.regime.trend.adx?.diPlus).toBeCloseTo(
      24.805756461698213,
      12,
    );
    expect(context?.regime.trend.adx?.diMinus).toBeCloseTo(
      10.847435115794926,
      12,
    );
    expect(context?.regime.trend.adx?.direction).toBe('bull');
    expect(context?.regime.trend.adx?.strength).toBe('developing');
  });

  it('ranks ATR percentile against current raw ATR percent, not ATR regime ratio', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 5,
        maSlow: 8,
        obvSma: 3,
        atr: 14,
        atrPctShort: 3,
        atrPctLong: 14,
        bb: 20,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 120; i += 1) {
      const close = 100 + i * 0.01;
      const range = i < 95 ? 10 : 0.2;
      indicators.next(
        makeCandle(
          i * INTERVAL_15M_MS,
          close,
          close + range / 2,
          close - range / 2,
        ),
      );
    }

    const rank =
      indicators.snapshot().baseContext?.regime.volatility.percentiles
        ?.atrPctRank100;

    expect(rank).not.toBeNull();
    expect(rank ?? 100).toBeLessThan(40);
  });

  it('marks MTF alignment mixed when current 15m trend conflicts with bullish higher timeframes', () => {
    const makeTrendCandles = (count: number, start: number, step: number) =>
      Array.from({ length: count }, (_, index) => {
        const close = start + index * step;
        return makeCandle(index * INTERVAL_15M_MS, close, close + 1, close - 1);
      });

    const mtf = buildBaseContextMtfSnapshot({
      candlesHistory: makeTrendCandles(80, 100, -1),
      btcCandlesHistory: makeTrendCandles(80, 200, 1),
      coinResampledCandles: {
        h1: makeTrendCandles(80, 100, 1),
        h4: makeTrendCandles(80, 100, 1),
        d1: makeTrendCandles(80, 100, 1),
      },
      btcResampledCandles: {
        h1: makeTrendCandles(80, 200, 1),
        h4: makeTrendCandles(80, 200, 1),
        d1: makeTrendCandles(80, 200, 1),
      },
      currentTrendBias: 'bear',
    });

    expect(mtf.summary?.h1TrendBias).toBe('bull');
    expect(mtf.summary?.h4TrendBias).toBe('bull');
    expect(mtf.summary?.d1TrendBias).toBe('bull');
    expect(mtf.summary?.mtfAlignment).toBe('mixed');
  });

  it('slides breakout level window with the same lookback and delay semantics across bars', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
        levelLookback: 3,
        levelDelay: 1,
      },
    });

    const highs = [12, 18, 16, 14, 20, 17];
    const lows = [7, 4, 6, 8, 3, 5];
    const snapshots: Array<ReturnType<typeof indicators.next> | null> = [];

    for (let i = 0; i < highs.length; i += 1) {
      snapshots.push(
        indicators.next(
          makeCandle(i * INTERVAL_15M_MS, 100 + i, highs[i], lows[i]),
        ),
      );
    }

    expect(snapshots[3]?.highLevel).toBe(18);
    expect(snapshots[3]?.lowLevel).toBe(4);

    expect(snapshots[4]?.highLevel).toBe(18);
    expect(snapshots[4]?.lowLevel).toBe(4);

    expect(snapshots[5]?.highLevel).toBe(20);
    expect(snapshots[5]?.lowLevel).toBe(3);
  });

  it('returns only base history when includeMlPayload is false', () => {
    const indicators = createIndicators([], [], {
      includeMlPayload: false,
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 30; i += 1) {
      indicators.next(makeCandle(i * INTERVAL_15M_MS, 100 + i));
    }

    const result = indicators.result() as Record<string, unknown>;
    expect(Array.isArray(result.maFast)).toBe(true);
    expect(result.candles15m).toBeUndefined();
    expect(result.maFast1h).toBeUndefined();
  });

  it('includes ML payload in result() with merged candles/timeframe series', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 160; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const result = indicators.result() as Record<string, any>;
    const snapshot = indicators.snapshot() as Record<string, any>;
    expect(Array.isArray(result.candles15m)).toBe(true);
    expect(result.candles15m).toHaveLength(50);
    expect(Array.isArray(result.btcCandles1h)).toBe(true);
    expect(result.btcCandles1h.length).toBeLessThanOrEqual(50);
    expect(Array.isArray(result.maFast1h)).toBe(true);
    expect(result.maFast1h.length).toBeGreaterThan(0);
    expect(Array.isArray(result.btcMaFast)).toBe(true);
    expect(Array.isArray(result.btcMaFast1h)).toBe(true);
    expect(Array.isArray(result.btcAtrPct4h)).toBe(true);
    expect(snapshot.baseContext).toBeTruthy();
    expect(snapshot.baseContext.raw.trend.maFast).toBeDefined();
    expect(snapshot.baseContext.mtf.candles.m15).toHaveLength(50);
    expect(snapshot.baseContext.mtf.summary.h1TrendBias).toBeDefined();
    expect(snapshot.baseContext.mtf.summary.mtfAlignment).toBeDefined();
  });

  it('memoizes baseContext for a captured snapshot', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 160; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const snapshot = indicators.snapshot();
    expect(snapshot.baseContext).toBeDefined();
    expect(snapshot.baseContext).toBe(snapshot.baseContext);
  });

  it('returns snapshot result that is not mutated by subsequent next() calls', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 120; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const first = indicators.result() as Record<string, any>;
    const firstMaFastLen = first.maFast.length;
    const firstCandlesLen = first.candles15m.length;
    const firstMaFastTail = first.maFast[first.maFast.length - 1];

    indicators.next(
      makeCandle(120 * INTERVAL_15M_MS, 221),
      makeCandle(120 * INTERVAL_15M_MS, 20221),
    );

    const second = indicators.result() as Record<string, any>;
    expect(first.maFast).not.toBe(second.maFast);
    expect(first.candles15m).not.toBe(second.candles15m);
    expect(first.maFast.length).toBe(firstMaFastLen);
    expect(first.candles15m.length).toBe(firstCandlesLen);
    expect(second.maFast[second.maFast.length - 1]).not.toBe(firstMaFastTail);
  });

  it('returns independent snapshots for repeated result() calls without next()', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 120; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const first = indicators.result() as Record<string, any>;
    const second = indicators.result() as Record<string, any>;

    expect(first.maFast).toEqual(second.maFast);
    expect(first.candles15m).toEqual(second.candles15m);
    expect(first.maFast).not.toBe(second.maFast);
    expect(first.candles15m).not.toBe(second.candles15m);
  });

  it('returns independent candle objects for repeated result() calls without next()', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 120; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const first = indicators.result() as Record<string, any>;
    const second = indicators.result() as Record<string, any>;

    expect(first.candles15m[0]).toEqual(second.candles15m[0]);
    expect(first.candles15m[0]).not.toBe(second.candles15m[0]);
  });

  it('keeps lazy baseContext mtf snapshot stable after later bars', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    for (let i = 0; i < 120; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const snapshot = indicators.snapshot();
    expect(snapshot.baseContext?.raw.trend.maFast).toBeDefined();

    indicators.next(
      makeCandle(120 * INTERVAL_15M_MS, 221),
      makeCandle(120 * INTERVAL_15M_MS, 20221),
    );

    expect(snapshot.baseContext?.mtf.candles.m15).toHaveLength(50);
    expect(
      snapshot.baseContext?.mtf.candles.m15[
        (snapshot.baseContext?.mtf.candles.m15.length ?? 1) - 1
      ]?.timestamp,
    ).toBe(119 * INTERVAL_15M_MS);
  });

  it('captures runtime state only for checkpoint bars and the last bar in cache snapshots', () => {
    const data = Array.from({ length: 5 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 5 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 200 + index),
    );

    const snapshots = buildIndicatorCacheSnapshots(data, btcData, {
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
      checkpointInterval: 2,
    });

    expect(snapshots).toHaveLength(5);
    expect(snapshots[0].runtimeState).not.toBeNull();
    expect(snapshots[1].runtimeState).toBeNull();
    expect(snapshots[2].runtimeState).not.toBeNull();
    expect(snapshots[3].runtimeState).toBeNull();
    expect(snapshots[4].runtimeState).not.toBeNull();
  });

  it('supports latestNumber for derived timeframe series', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 3,
        obvSma: 3,
        atr: 3,
        atrPctShort: 3,
        atrPctLong: 3,
        bb: 3,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    }) as ReturnType<typeof createIndicators> & {
      latestNumber: (key: string) => number | undefined;
    };

    for (let i = 0; i < 160; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const result = indicators.result() as Record<string, any>;
    const expected = result.maFast1h[result.maFast1h.length - 1];

    expect(indicators.latestNumber('maFast1h')).toBe(expected);
  });

  it('restores controller runtime state and preserves indicator parity after suffix replay', () => {
    const periods = {
      maFast: 3,
      maMedium: 3,
      maSlow: 3,
      obvSma: 3,
      atr: 3,
      atrPctShort: 3,
      atrPctLong: 3,
      bb: 3,
      bbStd: 2,
      macdFast: 3,
      macdSlow: 4,
      macdSignal: 2,
    };
    const coinData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index, 101 + index, 99 + index),
    );
    const btcData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(
        index * INTERVAL_15M_MS,
        20_000 + index,
        20_001 + index,
        19_999 + index,
      ),
    );

    const full = createIndicators([], [], { periods });
    coinData.forEach((candle, index) => {
      full.next(candle, btcData[index]);
    });

    const prefix = createIndicators([], [], { periods });
    coinData.slice(0, 120).forEach((candle, index) => {
      prefix.next(candle, btcData[index]);
    });

    const restored = createIndicators(coinData.slice(120), btcData.slice(120), {
      periods,
      initialRuntimeState: prefix.runtimeState(),
    });

    const fullSnapshot = full.snapshot() as Record<string, any>;
    const restoredSnapshot = restored.snapshot() as Record<string, any>;

    expect(restored.latestNumber('maFast')).toBe(full.latestNumber('maFast'));
    expect(restored.latestNumber('atrPct')).toBe(full.latestNumber('atrPct'));
    expect(restored.latestNumber('btcMaFast')).toBe(
      full.latestNumber('btcMaFast'),
    );
    expect(restoredSnapshot.baseContext).toEqual(fullSnapshot.baseContext);
  });

  it('restores compact checkpoint runtime state and preserves indicator parity after suffix replay', () => {
    const periods = {
      maFast: 3,
      maMedium: 3,
      maSlow: 3,
      obvSma: 3,
      atr: 3,
      atrPctShort: 3,
      atrPctLong: 3,
      bb: 3,
      bbStd: 2,
      macdFast: 3,
      macdSlow: 4,
      macdSignal: 2,
    };
    const coinData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index, 101 + index, 99 + index),
    );
    const btcData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(
        index * INTERVAL_15M_MS,
        20_000 + index,
        20_001 + index,
        19_999 + index,
      ),
    );

    const full = createIndicators([], [], { periods });
    coinData.forEach((candle, index) => {
      full.next(candle, btcData[index]);
    });

    const prefix = createIndicators([], [], { periods });
    coinData.slice(0, 120).forEach((candle, index) => {
      prefix.next(candle, btcData[index]);
    });

    const checkpointState = prefix.checkpointRuntimeState();
    expect(checkpointState.indicatorHistory).toBeUndefined();
    expect(checkpointState.btcRuntimeHistory).toBeUndefined();
    expect(checkpointState.latestIndicatorValues).toBeUndefined();

    const restored = createIndicators(coinData.slice(120), btcData.slice(120), {
      periods,
      initialRuntimeState: checkpointState,
    });

    const fullSnapshot = full.snapshot() as Record<string, any>;
    const restoredSnapshot = restored.snapshot() as Record<string, any>;

    expect(restored.latestNumber('maFast')).toBe(full.latestNumber('maFast'));
    expect(restored.latestNumber('atrPct')).toBe(full.latestNumber('atrPct'));
    expect(restored.latestNumber('btcMaFast')).toBe(
      full.latestNumber('btcMaFast'),
    );
    expect(restoredSnapshot.baseContext).toEqual(fullSnapshot.baseContext);
  });

  it('keeps runtime-only checkpoint state equal to the full indicator controller', () => {
    const periods = {
      maFast: 3,
      maMedium: 3,
      maSlow: 3,
      obvSma: 3,
      atr: 3,
      atrPctShort: 3,
      atrPctLong: 3,
      bb: 3,
      bbStd: 2,
      macdFast: 3,
      macdSlow: 4,
      macdSignal: 2,
    };
    const coinData = Array.from({ length: 140 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index, 101 + index, 99 + index),
    );
    const btcData = Array.from({ length: 140 }, (_, index) =>
      makeCandle(
        index * INTERVAL_15M_MS,
        20_000 + index,
        20_001 + index,
        19_999 + index,
      ),
    );
    const btcBinanceData = btcData.map((candle) => ({
      ...candle,
      close: candle.close - 10,
    }));
    const btcCoinbaseData = btcData.map((candle) => ({
      ...candle,
      close: candle.close + 10,
    }));

    const full = createIndicators([], [], {
      periods,
      btcBinanceData,
      btcCoinbaseData,
    });
    const runtimeOnly = createIndicators([], [], {
      periods,
      btcBinanceData,
      btcCoinbaseData,
      includeMlPayload: false,
      runtimeOnly: true,
    });

    coinData.forEach((candle, index) => {
      full.next(candle, btcData[index]);
      runtimeOnly.next(candle, btcData[index]);
    });

    expect(runtimeOnly.checkpointRuntimeState()).toEqual(
      full.checkpointRuntimeState(),
    );
  });

  it('keeps the last base indicator values in order after history window overflow', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
      includeMlPayload: false,
    });

    const expectedMaFast: number[] = [];

    for (let i = 0; i < ML_BASE_CANDLES_WINDOW + 25; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      const snapshot = indicators.next(makeCandle(ts, 100 + i));
      if (snapshot?.maFast != null) {
        expectedMaFast.push(snapshot.maFast);
      }
    }

    const result = indicators.result() as Record<string, number[]>;

    expect(result.maFast).toEqual(
      expectedMaFast.slice(-ML_BASE_CANDLES_WINDOW),
    );
    expect(result.maFast).toHaveLength(ML_BASE_CANDLES_WINDOW);
  });

  it('matches direct coin/btc correlation on the same sliding candle window', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    const coinHistory: Candle[] = [];
    const btcHistory: Candle[] = [];

    for (let i = 0; i < CORRELATION_WINDOW + 12; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      const coin = makeCandle(ts, 100 + i + (i % 3), 101 + i, 99 + i);
      const btc = makeCandle(ts, 200 + i * 2 + (i % 5), 201 + i, 199 + i);

      coinHistory.push(coin);
      btcHistory.push(btc);

      const snapshot = indicators.next(coin, btc);
      if (!snapshot) {
        continue;
      }

      const expected =
        calculateCoinBtcCorrelation(
          coinHistory.slice(-CORRELATION_WINDOW) as any,
          btcHistory.slice(-CORRELATION_WINDOW) as any,
        ).correlation ?? 0;

      expect(snapshot.correlation).toBe(expected);
    }
  });

  it('preserves 1h and 24h rolling window semantics on uneven timestamps', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 2,
        maMedium: 2,
        maSlow: 2,
        obvSma: 2,
        atr: 2,
        atrPctShort: 2,
        atrPctLong: 2,
        bb: 2,
        bbStd: 2,
        macdFast: 3,
        macdSlow: 4,
        macdSignal: 2,
      },
    });

    const oneHourMs = 60 * 60_000;
    const oneDayMs = 24 * oneHourMs;
    const stepPattern = [
      15 * 60_000,
      15 * 60_000,
      30 * 60_000,
      15 * 60_000,
      45 * 60_000,
    ];
    const candles: Candle[] = [];
    let timestamp = 0;

    const computeWindow = (currentTimestamp: number, windowMs: number) => {
      const timestamps = candles.map((item) => item.timestamp);
      const windowStart = currentTimestamp - windowMs;

      if (timestamps.length === 0 || timestamps[0] > windowStart) {
        return {
          high: null,
          low: null,
          volume: null,
          startClose: null,
          hasFullWindow: false,
        };
      }

      let startIdx = 0;
      while (
        startIdx < timestamps.length &&
        timestamps[startIdx] < windowStart
      ) {
        startIdx += 1;
      }

      let high = -Infinity;
      let low = Infinity;
      let volume = 0;

      for (let index = startIdx; index < candles.length; index += 1) {
        high = Math.max(high, candles[index].high);
        low = Math.min(low, candles[index].low);
        volume += candles[index].volume;
      }

      return {
        high,
        low,
        volume,
        startClose: candles[startIdx]?.close ?? null,
        hasFullWindow: true,
      };
    };

    const findNearestStartClose = (
      currentTimestamp: number,
      windowMs: number,
    ) => {
      const timestamps = candles.map((item) => item.timestamp);

      if (timestamps.length === 0) {
        return null;
      }

      const windowStart = currentTimestamp - windowMs;
      let idx = 0;
      while (idx < timestamps.length && timestamps[idx] < windowStart) {
        idx += 1;
      }

      if (idx <= 0) {
        return candles[0]?.close ?? null;
      }

      if (idx >= timestamps.length) {
        return candles[timestamps.length - 1]?.close ?? null;
      }

      const prevIdx = idx - 1;
      const currentIdx = timestamps.length - 1;
      if (idx === currentIdx && timestamps[idx] > windowStart) {
        return candles[prevIdx]?.close ?? null;
      }

      const prevDiff = windowStart - timestamps[prevIdx];
      const nextDiff = timestamps[idx] - windowStart;
      const chosenIdx = prevDiff <= nextDiff ? prevIdx : idx;

      return candles[chosenIdx]?.close ?? null;
    };

    for (let i = 0; i < 140; i += 1) {
      timestamp += stepPattern[i % stepPattern.length];
      const candle = makeCandle(
        timestamp,
        100 + i * 1.7,
        103 + (i % 7) * 2 + i,
        97 - (i % 5) + i * 0.3,
      );
      candles.push(candle);

      const snapshot = indicators.next(
        candle,
        makeCandle(timestamp, 20_000 + i),
      );
      if (!snapshot) {
        continue;
      }

      const window1h = computeWindow(timestamp, oneHourMs);
      const window24h = computeWindow(timestamp, oneDayMs);
      const price1hStart = findNearestStartClose(timestamp, oneHourMs);
      const price24hStart = findNearestStartClose(timestamp, oneDayMs);

      expect(snapshot.highPrice1h).toBe(
        window1h.hasFullWindow ? window1h.high : null,
      );
      expect(snapshot.lowPrice1h).toBe(
        window1h.hasFullWindow ? window1h.low : null,
      );
      expect(snapshot.volume1h).toBe(
        window1h.hasFullWindow ? window1h.volume : null,
      );
      expect(snapshot.highPrice24h).toBe(
        window24h.hasFullWindow ? window24h.high : null,
      );
      expect(snapshot.lowPrice24h).toBe(
        window24h.hasFullWindow ? window24h.low : null,
      );
      expect(snapshot.volume24h).toBe(
        window24h.hasFullWindow ? window24h.volume : null,
      );
      expect(snapshot.price1hPcnt).toBe(
        percentChange(candle.close, price1hStart ?? NaN) ?? 0,
      );
      expect(snapshot.price24hPcnt).toBe(
        percentChange(candle.close, price24hStart ?? NaN) ?? 0,
      );
    }
  });
});
