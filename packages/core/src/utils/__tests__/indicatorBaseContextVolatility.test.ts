import type { Candle } from '@tradejs/types';
import {
  calculateAtrAt,
  calculateAtrSeries,
  calculateRangeExpansionAt,
  calculateRealizedVolatility,
  calculateRecentAtrPctSeries,
  calculateRecentBbWidthPctSeries,
  calculateRecentRangeExpansionSeries,
  calculateRecentRealizedVolatilitySeries,
  calculateTrueRange,
} from '../indicatorBaseContextVolatility';

const makeCandle = (
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1000,
): Candle => ({
  timestamp,
  open,
  high,
  low,
  close,
  volume,
  turnover: close * volume,
});

const makeCandles = (): Candle[] =>
  Array.from({ length: 32 }, (_, index) => {
    const close = 100 + index * 1.2 + Math.sin(index / 3) * 2;
    const open = close - 0.4 + (index % 3) * 0.2;
    return makeCandle(
      index * 60_000,
      open,
      close + 1.3 + (index % 4) * 0.4,
      close - 1.1 - (index % 5) * 0.3,
      close,
      900 + index * 11,
    );
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

describe('indicatorBaseContextVolatility', () => {
  it('calculates true range with previous close gaps', () => {
    const previous = makeCandle(0, 100, 105, 95, 102);
    const current = makeCandle(60_000, 110, 112, 108, 111);

    expect(calculateTrueRange(current, null)).toBe(4);
    expect(calculateTrueRange(current, previous)).toBe(10);
  });

  it('keeps ATR point and rolling series calculations aligned', () => {
    const candles = makeCandles();
    const period = 5;
    const series = calculateAtrSeries(candles, period);

    for (let index = 0; index < candles.length; index += 1) {
      expectNullableClose(
        series[index],
        calculateAtrAt(candles, index, period),
      );
    }
  });

  it('returns recent bounded volatility series in chronological order', () => {
    const candles = makeCandles();
    const closes = candles.map((item) => item.close);
    const lookback = 7;

    const atrPct = calculateRecentAtrPctSeries(candles, lookback, 5);
    const bbWidth = calculateRecentBbWidthPctSeries(closes, lookback, 5, 2);
    const realized = calculateRecentRealizedVolatilitySeries(
      closes,
      lookback,
      5,
    );
    const rangeExpansion = calculateRecentRangeExpansionSeries(
      candles,
      lookback,
    );

    expect(atrPct).toHaveLength(lookback);
    expect(bbWidth).toHaveLength(lookback);
    expect(realized).toHaveLength(lookback);
    expect(rangeExpansion).toHaveLength(lookback);
    expectNullableClose(
      realized[realized.length - 1],
      calculateRealizedVolatility(closes, 5),
    );
    expectNullableClose(
      rangeExpansion[rangeExpansion.length - 1],
      calculateRangeExpansionAt(candles, candles.length - 1),
    );
  });
});
