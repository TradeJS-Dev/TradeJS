import { getSma } from '../utils';

const makeCandles = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const close = 100 + i * 0.7 + Math.sin(i / 3) * 2;
    const volume = 1000 + i * 7;

    return {
      timestamp: i * 60_000,
      open: close - 0.4 + Math.cos(i / 5) * 0.2,
      high: close + 1.5 + (i % 4) * 0.2,
      low: close - 1.2 - (i % 3) * 0.15,
      close,
      dt: new Date(i * 60_000).toISOString(),
      volume,
      turnover: volume * close,
    };
  });

describe('TrendLine utils', () => {
  it('keeps SMA result parity with historical technicalindicators output', () => {
    const result = getSma(20, makeCandles(80));

    expect(result.values).toHaveLength(61);
    expect(result.values[0]).toBeCloseTo(106.65287999656167, 12);
    expect(result.last).toBeCloseTo(148.7560140232139, 12);
  });

  it('preserves the historical one-candle SMA edge case', () => {
    const result = getSma(20, makeCandles(1));

    expect(result.values).toEqual([Infinity]);
    expect(result.last).toBe(Infinity);
  });
});
