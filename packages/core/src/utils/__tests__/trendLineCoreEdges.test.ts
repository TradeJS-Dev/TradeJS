import { KLineData } from 'klinecharts';
import {
  findTrendlinesByHighs,
  findTrendlinesByLows,
} from '@utils/trendLine/core';

const buildCandles = (length: number, trend: 'up' | 'down'): KLineData[] => {
  const start = 1_700_200_000_000;
  const step = 60_000;
  const data: KLineData[] = [];

  for (let i = 0; i < length; i += 1) {
    const direction = trend === 'up' ? 1 : -1;
    const base = 100 + direction * i * 0.5;
    const dip = i % 10 === 0 ? 5 : 0;
    const spike = i % 10 === 5 ? 5 : 0;
    const extraSwing = i === length - 1 ? 8 : 0;
    const low = base - dip - extraSwing;
    const high = base + spike + extraSwing;

    data.push({
      timestamp: start + i * step,
      open: base,
      high,
      low,
      close: base,
      volume: 1,
      turnover: 1,
    } as KLineData);
  }

  return data;
};

describe('trendLine/core edge cases', () => {
  it('returns empty arrays for empty input and invalid range window', () => {
    const noDataLows = findTrendlinesByLows([]);
    const noDataHighs = findTrendlinesByHighs([]);
    const candles = buildCandles(20, 'up');
    const invalidRange = findTrendlinesByLows(candles, {
      range: 100,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: false,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    });

    expect(noDataLows).toEqual([]);
    expect(noDataHighs).toEqual([]);
    expect(invalidRange).toEqual([]);
  });

  it('supports default options in public wrappers', () => {
    const upCandles = buildCandles(80, 'up');
    const downCandles = buildCandles(80, 'down');

    const lows = findTrendlinesByLows(upCandles);
    const highs = findTrendlinesByHighs(downCandles);

    expect(Array.isArray(lows)).toBe(true);
    expect(Array.isArray(highs)).toBe(true);
  });

  it('capture mode blocks lines when offset is non-positive', () => {
    const candles = buildCandles(80, 'up');
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 0,
      capture: true,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    const lines = findTrendlinesByLows(candles, options);
    expect(lines).toEqual([]);
  });

  it('does not reject by touch-gap rule when maxTouchGap is non-positive', () => {
    const candles = buildCandles(80, 'up');
    const withGapCheck = findTrendlinesByLows(candles, {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: false,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    });
    const withoutGapCheck = findTrendlinesByLows(candles, {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 0,
      offset: 5,
      capture: false,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    });

    expect(withoutGapCheck.length).toBeGreaterThanOrEqual(withGapCheck.length);
  });
});
