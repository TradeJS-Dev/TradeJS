import { KLineData } from 'klinecharts';
import { createTrendlineEngine } from '@utils/trendLine/engine';

const buildCandles = (lows: number[]): KLineData[] => {
  const start = 1_700_000_000_000;
  const step = 60_000;
  return lows.map((low, index) => {
    const open = low + 0.6;
    const close = low + 0.6;
    const high = low + 1.2;
    return {
      timestamp: start + index * step,
      open,
      high,
      low,
      close,
      volume: 1,
      turnover: 1,
    } as KLineData;
  });
};

const hasLineWithEndValue = (
  lines: Array<{ points: { value: number }[] }>,
  expected: number,
  tolerance = 0.05,
) =>
  lines.some((line) => {
    const endValue = line.points[line.points.length - 1]?.value;
    if (endValue == null) return false;
    return Math.abs(endValue - expected) <= tolerance;
  });

describe('trendLineEngine capture window', () => {
  it('keeps candidates so a capture hit can make a line valid later', () => {
    const lows = [12, 11, 10, 11.5, 12.5, 13, 12, 13.5, 14.5, 16, 15, 15.2, 13];

    const candles = buildCandles(lows);

    const opts = {
      mode: 'lows' as const,
      range: 1,
      firstRange: 1,
      minTouches: 2,
      minDistance: 2,
      minTouchGap: 1,
      maxTouchGap: 100,
      offset: 2,
      capture: true,
      bestLines: 5,
      maxLines: 20,
      maxDistance: 100,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    const engine = createTrendlineEngine(candles.slice(0, -1), opts);

    const before = engine.getLines();
    expect(hasLineWithEndValue(before, 14.5)).toBe(false);
    expect(hasLineWithEndValue(before, 15.75)).toBe(true);

    const after = engine.next(candles[candles.length - 1]);
    expect(hasLineWithEndValue(after, 15)).toBe(true);
  });
});
