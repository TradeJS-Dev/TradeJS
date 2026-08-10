import { Candle } from '@tradejs/types';
import { adx, rsi } from 'fast-technical-indicators';
import {
  createIndicators,
  getRequiredControllerSeedWindow,
} from '../indicators';
import {
  buildBaseContextMtfSnapshot,
  buildPsychologicalLevelAssetContext,
  buildSessionContext,
  buildTargetVsBtcContext,
  buildTargetVsEthContext,
} from '../indicatorBaseContext';
import { CORRELATION_WINDOW, ML_BASE_CANDLES_WINDOW } from '../../constants';
import { calculateCoinBtcCorrelation } from '../correlation';
import {
  averageLastN as indicatorAverageLastN,
  calculateLineSlope,
} from '../indicatorMath';
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

describe('buildTargetVsBtcContext', () => {
  it('computes target ratio returns, alpha, beta, and correlation from aligned candles', () => {
    const coin1h = [makeCandle(1, 100), makeCandle(2, 112)];
    const btc1h = [makeCandle(1, 100), makeCandle(2, 104)];
    const coin4h = [makeCandle(1, 100), makeCandle(2, 120)];
    const btc4h = [makeCandle(1, 100), makeCandle(2, 105)];
    const coin1d = [makeCandle(1, 100), makeCandle(2, 130)];
    const btc1d = [makeCandle(1, 100), makeCandle(2, 110)];
    const coinCandles = Array.from({ length: 24 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index * 2),
    );
    const btcCandles = Array.from({ length: 24 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );

    const context = buildTargetVsBtcContext({
      coin1h,
      btc1h,
      coin4h,
      btc4h,
      coin1d,
      btc1d,
      coinCandles,
      btcCandles,
    });

    expect(context).toMatchObject({
      source: 'aligned_ohlcv',
      ratioTrend: 'up',
      alphaVsBtc1h: 8,
      alphaVsBtc4h: 15,
      alphaVsBtc24h: 20,
    });
    expect(context.ratioReturn1h).toBeCloseTo(
      percentChange(112 / 104, 100 / 100) ?? 0,
      8,
    );
    expect(context.ratioReturn24h).toBeCloseTo(
      percentChange(130 / 110, 100 / 100) ?? 0,
      8,
    );
    expect(context.betaToBtc20).toBeGreaterThan(1);
    expect(context.correlationToBtc20).toBeGreaterThan(0.99);
  });
});

describe('buildTargetVsEthContext', () => {
  it('computes target ratio returns, alpha, beta, and correlation against ETH', () => {
    const coin1h = [makeCandle(1, 100), makeCandle(2, 112)];
    const eth1h = [makeCandle(1, 100), makeCandle(2, 104)];
    const coin4h = [makeCandle(1, 100), makeCandle(2, 120)];
    const eth4h = [makeCandle(1, 100), makeCandle(2, 105)];
    const coin1d = [makeCandle(1, 100), makeCandle(2, 130)];
    const eth1d = [makeCandle(1, 100), makeCandle(2, 110)];
    const coinCandles = Array.from({ length: 24 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index * 2),
    );
    const ethCandles = Array.from({ length: 24 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );

    const context = buildTargetVsEthContext({
      coin1h,
      eth1h,
      coin4h,
      eth4h,
      coin1d,
      eth1d,
      coinCandles,
      ethCandles,
    });

    expect(context).toMatchObject({
      source: 'aligned_ohlcv',
      ratioTrend: 'up',
      alphaVsEth1h: 8,
      alphaVsEth4h: 15,
      alphaVsEth24h: 20,
    });
    expect(context?.ratioReturn24h).toBeCloseTo(
      percentChange(130 / 110, 100 / 100) ?? 0,
      8,
    );
    expect(context?.betaToEth20).toBeGreaterThan(1);
    expect(context?.correlationToEth20).toBeGreaterThan(0.99);
  });

  it('skips self-reference ETH context', () => {
    const candles = [makeCandle(1, 100), makeCandle(2, 110)];

    expect(
      buildTargetVsEthContext({
        coin1h: candles,
        eth1h: candles,
        coin4h: candles,
        eth4h: candles,
        coin1d: candles,
        eth1d: candles,
        coinCandles: candles,
        ethCandles: candles,
      }),
    ).toBeNull();
  });
});

describe('buildSessionContext', () => {
  it('classifies session edge phase and UTC weekday', () => {
    const opening = buildSessionContext(Date.UTC(2026, 5, 8, 13, 30));
    const closing = buildSessionContext(Date.UTC(2026, 5, 8, 21, 30));
    const offHours = buildSessionContext(Date.UTC(2026, 5, 7, 23, 30));

    expect(opening).toMatchObject({
      sessionPhase: 'us',
      sessionWindowPhase: 'opening',
      minutesFromSessionOpen: 30,
      minutesToSessionClose: 510,
      dayOfWeekUtc: 1,
      isWeekdayUtc: true,
      isWeekendUtc: false,
    });
    expect(closing.sessionWindowPhase).toBe('closing');
    expect(offHours).toMatchObject({
      sessionPhase: 'off_hours',
      sessionWindowPhase: 'off_hours',
      dayOfWeekUtc: 7,
      isWeekdayUtc: false,
      isWeekendUtc: true,
    });
  });
});

describe('buildPsychologicalLevelAssetContext', () => {
  it('detects causal BTC close crossings over 15m, 1h, and 4h windows', () => {
    const closes = Array.from({ length: 17 }, () => 62_456);
    closes[12] = 61_950;
    closes[15] = 62_456;
    closes[16] = 61_897;
    const candles = closes.map((close, index) =>
      makeCandle(index * INTERVAL_15M_MS, close),
    );

    expect(buildPsychologicalLevelAssetContext(candles, 1_000)).toEqual({
      source: 'aligned_15m_ohlcv',
      stepUsd: 1_000,
      windows: {
        m15: {
          crossed: true,
          direction: 'down',
          level: 62_000,
          levelsCrossed: 1,
          distanceBeyondLevelBps: expect.closeTo(16.612903225806452),
        },
        h1: {
          crossed: false,
          direction: 'none',
          level: null,
          levelsCrossed: 0,
          distanceBeyondLevelBps: null,
        },
        h4: {
          crossed: true,
          direction: 'down',
          level: 62_000,
          levelsCrossed: 1,
          distanceBeyondLevelBps: expect.closeTo(16.612903225806452),
        },
      },
    });
  });

  it('uses the ETH step and reports unavailable windows without exact causal history', () => {
    const candles = [makeCandle(0, 3_950), makeCandle(INTERVAL_15M_MS, 4_125)];

    expect(buildPsychologicalLevelAssetContext(candles, 100)).toMatchObject({
      stepUsd: 100,
      windows: {
        m15: {
          crossed: true,
          direction: 'up',
          level: 4_100,
          levelsCrossed: 2,
          distanceBeyondLevelBps: expect.closeTo(60.97560975609756),
        },
        h1: { crossed: null, direction: 'unknown' },
        h4: { crossed: null, direction: 'unknown' },
      },
    });
  });

  it('preserves BTC and ETH windows after compact checkpoint restore', () => {
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
    const coinData = Array.from({ length: 40 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcCloses = Array.from({ length: 40 }, () => 62_100);
    btcCloses[23] = 63_500;
    btcCloses[35] = 61_500;
    btcCloses[38] = 62_456;
    btcCloses[39] = 61_897;
    const btcData = btcCloses.map((close, index) =>
      makeCandle(index * INTERVAL_15M_MS, close),
    );
    const ethCloses = Array.from({ length: 40 }, () => 4_050);
    ethCloses[23] = 3_850;
    ethCloses[35] = 4_250;
    ethCloses[38] = 4_050;
    ethCloses[39] = 4_125;
    const ethData = ethCloses.map((close, index) =>
      makeCandle(index * INTERVAL_15M_MS, close),
    );

    const full = createIndicators(coinData, btcData, {
      periods,
      ethData,
      includeMlPayload: false,
    });
    const prefix = createIndicators(
      coinData.slice(0, -1),
      btcData.slice(0, -1),
      {
        periods,
        ethData: ethData.slice(0, -1),
        includeMlPayload: false,
      },
    );
    const checkpoint = prefix.checkpointRuntimeState();
    const restored = createIndicators(coinData.slice(-1), btcData.slice(-1), {
      periods,
      ethData: ethData.slice(-1),
      includeMlPayload: false,
      initialRuntimeState: checkpoint,
    });

    const fullContext =
      full.latestSnapshot()?.baseContext?.relative.referencePsychologicalLevels;
    const restoredContext =
      restored.latestSnapshot()?.baseContext?.relative
        .referencePsychologicalLevels;

    expect(restoredContext).toEqual(fullContext);
    expect(restoredContext).toMatchObject({
      BTCUSDT: {
        windows: {
          m15: { crossed: true, direction: 'down', level: 62_000 },
          h1: { crossed: false, direction: 'none', level: null },
          h4: {
            crossed: true,
            direction: 'down',
            level: 62_000,
            levelsCrossed: 2,
          },
        },
      },
      ETHUSDT: {
        windows: {
          m15: { crossed: true, direction: 'up', level: 4_100 },
          h1: { crossed: true, direction: 'down', level: 4_200 },
          h4: {
            crossed: true,
            direction: 'up',
            level: 4_100,
            levelsCrossed: 3,
          },
        },
      },
    });
  });
});

describe('baseContext ETH reference propagation', () => {
  it('builds targetVsEth from ETH candles passed to createIndicators', () => {
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
    const coinData = Array.from({ length: 40 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index * 2),
    );
    const btcData = Array.from({ length: 40 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );
    const ethData = Array.from({ length: 40 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 1_000 + index),
    ).reverse();

    const indicators = createIndicators(coinData, btcData, {
      periods,
      ethData,
      includeMlPayload: false,
    });
    const baseContext = indicators.latestSnapshot()?.baseContext;

    expect(baseContext?.relative.targetVsEth).toMatchObject({
      source: 'aligned_ohlcv',
      ratioTrend: 'up',
    });
    expect(baseContext?.relative.targetVsEth?.alphaVsEth1h).toBeGreaterThan(0);
    expect(baseContext?.relative.targetVsEth?.betaToEth20).toBeGreaterThan(1);
    expect(
      baseContext?.relative.targetVsEth?.correlationToEth20,
    ).toBeGreaterThan(0.99);
    expect(baseContext?.relative.referencePsychologicalLevels).toMatchObject({
      BTCUSDT: {
        source: 'aligned_15m_ohlcv',
        stepUsd: 1_000,
      },
      ETHUSDT: {
        source: 'aligned_15m_ohlcv',
        stepUsd: 100,
      },
    });
  });
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

const safeDivide = (
  numerator: number | null | undefined,
  denominator: number | null | undefined,
) =>
  numerator == null ||
  denominator == null ||
  !Number.isFinite(numerator) ||
  !Number.isFinite(denominator) ||
  denominator === 0
    ? null
    : numerator / denominator;

const normalizeContextNumber = (value: number | null): number | null =>
  value == null || !Number.isFinite(value) ? value : Number(value.toFixed(12));

const averageLastN = (values: number[], period: number): number | null => {
  if (values.length < period) {
    return null;
  }

  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
};

const calculateFullEma = (values: number[], period: number): number | null => {
  if (values.length < period) {
    return null;
  }

  const seed =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const multiplier = 2 / (period + 1);
  return normalizeContextNumber(
    values
      .slice(period)
      .reduce(
        (emaValue, value) => value * multiplier + emaValue * (1 - multiplier),
        seed,
      ),
  );
};

const calculateTrueRange = (current: Candle, previous: Candle | null) =>
  previous == null
    ? current.high - current.low
    : Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );

const calculateFullPercentRank = (
  values: Array<number | null | undefined>,
  current: number | null,
  lookback: number,
) => {
  const finite = values.filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value),
  );
  const window = finite.slice(-lookback);
  if (current == null || window.length < 3) {
    return null;
  }

  return (
    (window.filter((value) => value <= current).length / window.length) * 100
  );
};

const calculateFullRealizedVolatility = (closes: number[], period = 20) => {
  const window = closes.slice(-(period + 1));
  if (window.length < period + 1) {
    return null;
  }

  const returns = window.slice(1).map((close, index) => {
    const previous = window[index];
    return previous > 0 ? Math.log(close / previous) : 0;
  });
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;

  return Math.sqrt(variance);
};

const calculateFullRealizedVolatilitySeries = (closes: number[], period = 20) =>
  closes.map((_, index) =>
    calculateFullRealizedVolatility(closes.slice(0, index + 1), period),
  );

const calculateFullBbWidthPctSeries = (
  closes: number[],
  period = 20,
  stdMultiplier = 2,
) =>
  closes.map((_, index) => {
    const window = closes.slice(Math.max(0, index + 1 - period), index + 1);
    if (window.length < period) {
      return null;
    }

    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance =
      window.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      window.length;
    const std = Math.sqrt(variance);

    return mean === 0 ? null : ((std * stdMultiplier * 2) / mean) * 100;
  });

const calculateFullAtrPctSeries = (candles: Candle[], period = 14) =>
  candles.map((_, index) => {
    const window = candles.slice(Math.max(0, index + 1 - period), index + 1);
    if (window.length < period) {
      return null;
    }

    const atrValue =
      window.reduce((sum, item, windowIndex) => {
        const absoluteIndex = index + 1 - window.length + windowIndex;
        const previous = absoluteIndex > 0 ? candles[absoluteIndex - 1] : null;
        return sum + calculateTrueRange(item, previous);
      }, 0) / period;

    return safeDivide(atrValue, candles[index].close);
  });

const calculateFullRangeExpansionSeries = (candles: Candle[]) =>
  candles.map((item, index) => {
    const previous = index > 0 ? candles[index - 1] : null;
    return safeDivide(item.high - item.low, calculateTrueRange(item, previous));
  });

const expectNullableClose = (
  actual: number | null | undefined,
  expected: number | null,
) => {
  if (expected == null) {
    expect(actual).toBeNull();
    return;
  }

  expect(actual).toBeCloseTo(expected, 12);
};

describe('utils indicators', () => {
  it('calculates line slope from the last finite values only', () => {
    expect(
      calculateLineSlope(
        [1, null, 2, Number.NaN, undefined, 4, Number.POSITIVE_INFINITY, 7],
        3,
      ),
    ).toBeCloseTo(2.5, 12);
    expect(calculateLineSlope([null, Number.NaN, 5], 3)).toBeNull();
  });

  it('averages the last finite values without requiring contiguous data', () => {
    expect(
      indicatorAverageLastN(
        [1, Number.NaN, 3, Number.POSITIVE_INFINITY, 5, 7],
        3,
      ),
    ).toBe(5);
    expect(indicatorAverageLastN([1, Number.NaN], 2)).toBeNull();
  });

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
    expect(context?.structure.srZones?.levels.length ?? 0).toBeGreaterThan(0);
    expect(context?.structure.srZones?.nearestResistance.level).toBeGreaterThan(
      100,
    );
    expect(context?.structure.liquidityZones?.activeCount ?? 0).toBeGreaterThan(
      0,
    );
    expect(
      context?.structure.liquidityZones?.nearestResistance.level,
    ).toBeGreaterThan(100);
    expect(
      context?.structure.liquidityTails?.currentTail.wickAtr ?? 0,
    ).toBeGreaterThan(0);
    expect(context?.structure.structureZones?.state).not.toBe('unknown');
    expect(context?.structure.structureZones?.resistance.level).toBeGreaterThan(
      100,
    );
    expect(
      context?.participation.volumeStructure?.pointOfControl,
    ).toBeGreaterThan(102);
    expect(context?.participation.volumeStructure?.pointOfControl).toBeLessThan(
      108,
    );
    expect(
      context?.participation.volumeStructure?.pointOfControlVolumeShare ?? 0,
    ).toBeGreaterThan(0.15);
    expect(
      context?.participation.volumeStructure?.totalUpVolumeShare ?? 0,
    ).toBeGreaterThan(0);
    expect(
      context?.participation.volumeStructure?.totalDownVolumeShare ?? 0,
    ).toBeGreaterThan(0);
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
    expect(trend?.adaptiveChannel?.regime).toBe('bull');
    expect(trend?.adaptiveChannel?.roof).toBeDefined();
    expect(trend?.adaptiveChannel?.floor).toBeDefined();
    expect(trend?.adaptiveChannel?.channelWidthAtr).toBeCloseTo(2, 6);
    expect(trend?.adaptiveChannel?.pricePositionInChannel ?? 0).toBeGreaterThan(
      0.5,
    );
    expect(trend?.trendFollow?.state).not.toBe('unknown');
    expect(trend?.trendFollow?.lastSignalDirection).toBeDefined();
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
    expect(context?.regime.trend.psar?.value).toBeDefined();
    expect(context?.regime.trend.psar?.direction).toBe('bull');
    expect(context?.regime.trend.psar?.emaFilter).toBeDefined();
    expect(context?.regime.trend.psar?.adxOk).toBe(true);
    expect(context?.regime.trend.maLayers?.stackScore).toBeGreaterThanOrEqual(
      0,
    );
    expect(context?.regime.trend.maLayers?.trendState).toBeDefined();
  });

  it('matches rolling baseContext RSI and ADX with fast-technical-indicators batch calculations', () => {
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
    const candles: Candle[] = [];

    for (let i = 0; i < 280; i += 1) {
      const close =
        120 +
        Math.sin(i / 6) * 8 +
        Math.cos(i / 11) * 3 +
        i * 0.04 +
        ((i % 9) - 4) * 0.21;
      const candle = makeCandle(
        i * INTERVAL_15M_MS,
        close,
        close + 1.4 + (i % 7) * 0.11,
        close - 1.2 - (i % 6) * 0.09,
        1_000 + (i % 23) * 17,
      );
      candles.push(candle);
      indicators.next(candle);
    }

    const context = indicators.snapshot().baseContext;
    const closes = candles.map((item) => item.close);
    const expectedRsi = rsi({ values: closes, period: 14 }).at(-1);
    const expectedAdx = adx({
      close: closes,
      high: candles.map((item) => item.high),
      low: candles.map((item) => item.low),
      period: 14,
    }).at(-1);

    expect(expectedRsi).toBeDefined();
    expect(expectedAdx).toBeDefined();
    expect(context?.regime.momentum.rsi).toBeCloseTo(expectedRsi ?? 0, 12);
    expect(context?.regime.trend.adx?.adx).toBeCloseTo(
      expectedAdx?.adx ?? 0,
      12,
    );
    expect(context?.regime.trend.adx?.diPlus).toBeCloseTo(
      expectedAdx?.pdi ?? 0,
      12,
    );
    expect(context?.regime.trend.adx?.diMinus).toBeCloseTo(
      expectedAdx?.mdi ?? 0,
      12,
    );
  });

  it('matches rolling baseContext trend contexts with full-series calculations', () => {
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
    const candles: Candle[] = [];

    for (let i = 0; i < 260; i += 1) {
      const close =
        90 +
        Math.sin(i / 5) * 5 +
        Math.cos(i / 17) * 9 +
        i * 0.05 +
        ((i % 11) - 5) * 0.18;
      const candle = makeCandle(
        i * INTERVAL_15M_MS,
        close,
        close + 1.3 + (i % 5) * 0.16,
        close - 1.0 - (i % 4) * 0.14,
        800 + (i % 29) * 23,
      );
      candles.push(candle);
      indicators.next(candle);
    }

    const trend = indicators.snapshot().baseContext?.regime.trend;
    const closes = candles.map((item) => item.close);
    const hl2 = candles.map((item) => (item.high + item.low) / 2);
    const latestClose = closes[closes.length - 1];
    const atr = indicators.snapshot().baseContext?.raw.volatility.atr ?? null;
    const expectedLayerPeriods = [
      [5, 12],
      [9, 13],
      [34, 50],
      [72, 89],
      [180, 200],
    ] as const;

    expectedLayerPeriods.forEach(([fastPeriod, slowPeriod], index) => {
      const layer = trend?.maLayers?.layers[index];
      expect(layer?.fast).toBeCloseTo(
        calculateFullEma(hl2, fastPeriod) ?? 0,
        12,
      );
      expect(layer?.slow).toBeCloseTo(
        calculateFullEma(hl2, slowPeriod) ?? 0,
        12,
      );
    });

    const expectedContextBaseline = calculateFullEma(closes, 34);
    const expectedBoundaryWidth = atr == null ? null : atr * 1.2;
    const expectedUpperBoundary =
      expectedContextBaseline == null || expectedBoundaryWidth == null
        ? null
        : expectedContextBaseline + expectedBoundaryWidth;
    const expectedLowerBoundary =
      expectedContextBaseline == null || expectedBoundaryWidth == null
        ? null
        : expectedContextBaseline - expectedBoundaryWidth;
    const expectedNearestBoundary =
      latestClose > (expectedUpperBoundary ?? Number.POSITIVE_INFINITY)
        ? expectedUpperBoundary
        : latestClose < (expectedLowerBoundary ?? Number.NEGATIVE_INFINITY)
          ? expectedLowerBoundary
          : expectedContextBaseline;

    expectNullableClose(trend?.contextMa?.baseline, expectedContextBaseline);
    expectNullableClose(trend?.contextMa?.upperBoundary, expectedUpperBoundary);
    expectNullableClose(trend?.contextMa?.lowerBoundary, expectedLowerBoundary);
    expectNullableClose(
      trend?.contextMa?.distanceToBoundaryAtr,
      expectedNearestBoundary == null
        ? null
        : safeDivide(latestClose - expectedNearestBoundary, atr),
    );

    expect(trend?.adaptiveChannel?.centerline).toBeDefined();
    expect(trend?.adaptiveChannel?.roof).toBe(trend?.adaptiveChannel?.upper);
    expect(trend?.adaptiveChannel?.floor).toBe(trend?.adaptiveChannel?.lower);
    expect(trend?.adaptiveChannel?.regime).not.toBe('unknown');
    expect(trend?.adaptiveChannel?.channelWidthAtr).toBeCloseTo(2, 12);
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

  it('keeps volatility percentile ranks equal to full-series calculations', () => {
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
    const candles: Candle[] = [];
    let last: ReturnType<typeof indicators.next> | null = null;

    for (let i = 0; i < 360; i += 1) {
      const close =
        100 +
        Math.sin(i / 5) * 4 +
        Math.cos(i / 19) * 7 +
        i * 0.03 +
        ((i % 17) - 8) * 0.09;
      const candle = makeCandle(
        i * INTERVAL_15M_MS,
        close,
        close + 1.2 + (i % 6) * 0.19,
        close - 1.1 - (i % 5) * 0.17,
        900 + (i % 37) * 31,
      );
      candles.push(candle);
      last = indicators.next(candle);
    }

    const context = last?.baseContext;
    const percentiles = context?.regime.volatility.percentiles;
    const closes = candles.map((item) => item.close);
    const latestCandle = candles[candles.length - 1];
    const currentRawAtrPct = safeDivide(
      context?.raw.volatility.atr,
      latestCandle.close,
    );
    const realizedVolatility = calculateFullRealizedVolatility(closes);
    const rangeExpansionSeries = calculateFullRangeExpansionSeries(candles);
    const rangeExpansion =
      rangeExpansionSeries[rangeExpansionSeries.length - 1] ?? null;

    expectNullableClose(
      percentiles?.atrPctRank100,
      calculateFullPercentRank(
        calculateFullAtrPctSeries(candles),
        currentRawAtrPct,
        100,
      ),
    );
    expectNullableClose(
      percentiles?.bbWidthRank100,
      calculateFullPercentRank(
        calculateFullBbWidthPctSeries(closes),
        context?.raw.volatility.bbWidthPct ?? null,
        100,
      ),
    );
    expectNullableClose(
      percentiles?.realizedVolRank100,
      calculateFullPercentRank(
        calculateFullRealizedVolatilitySeries(closes),
        realizedVolatility,
        100,
      ),
    );
    expectNullableClose(
      percentiles?.rangeExpansionRank20,
      calculateFullPercentRank(rangeExpansionSeries, rangeExpansion, 20),
    );
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

    for (let i = 0; i < 260; i += 1) {
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
    expect(snapshot.baseContext?.regime).toBe(snapshot.baseContext?.regime);
    expect(snapshot.baseContext?.structure).toBe(
      snapshot.baseContext?.structure,
    );
    expect(snapshot.baseContext?.participation).toBe(
      snapshot.baseContext?.participation,
    );
    expect(snapshot.baseContext?.relative).toBe(snapshot.baseContext?.relative);
    expect(snapshot.baseContext?.mtf).toBe(snapshot.baseContext?.mtf);
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

  it('returns the latest numeric history window without changing its order', () => {
    const indicators = createIndicators([], [], {
      periods: {
        maFast: 3,
        maMedium: 3,
        maSlow: 4,
      },
    });

    for (let i = 0; i < 160; i += 1) {
      const ts = i * INTERVAL_15M_MS;
      indicators.next(makeCandle(ts, 100 + i), makeCandle(ts, 20000 + i));
    }

    const expected = (indicators.result().maFast ?? []).slice(-2);
    expect(indicators.latestNumbers('maFast', 2)).toEqual(expected);
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

  it('updates venue reference candles without rebuilding indicator state', () => {
    const coinData = Array.from({ length: 60 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 10 + index),
    );
    const btcData = Array.from({ length: 60 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcBinanceData = btcData.map((candle) => ({
      ...candle,
      close: 100,
    }));
    const btcCoinbaseData = btcData.map((candle) => ({
      ...candle,
      close: 101,
    }));
    const indicators = createIndicators(coinData, btcData, {
      btcBinanceData,
      btcCoinbaseData,
      includeMlPayload: false,
      runtimeOnly: true,
    });
    const first = indicators.latestSnapshot();
    const secondTimestamp = 60 * INTERVAL_15M_MS;

    indicators.updateReferenceData({
      btcBinanceData: [...btcBinanceData, makeCandle(secondTimestamp, 100)],
      btcCoinbaseData: [...btcCoinbaseData, makeCandle(secondTimestamp, 110)],
    });
    const second = indicators.next(
      makeCandle(secondTimestamp, 11),
      makeCandle(secondTimestamp, 101),
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      throw new Error('Expected indicator snapshots');
    }
    expect(first.spread).not.toBeNull();
    expect(second.spread).not.toBeNull();
    expect(second.spread!).toBeGreaterThan(first.spread!);
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
