import { ATR_PCT } from '../atrPct';

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
};

const makeConstantCandles = (count: number): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: i * 60_000,
    open: 100,
    high: 110,
    low: 90,
    close: 100,
    volume: 1000,
    turnover: 100_000,
  }));

describe('ATR_PCT', () => {
  it('returns zero value when not enough data for long SMA', () => {
    const data = makeConstantCandles(20) as any[];
    const result = ATR_PCT(data, 14, 7, 30);

    expect(result.shortLine.length).toBe(result.longLine.length);
    expect(result.shortLine.length).toBeGreaterThan(0);
    expect(result.value).toBe(0);
  });

  it('builds aligned short/long lines and rounded ratio value', () => {
    const data = makeConstantCandles(120) as any[];
    const period = 14;
    const short = 7;
    const long = 30;
    const result = ATR_PCT(data, period, short, long);

    const firstShortIndex = period + short - 2;
    const firstLongIndex = period + long - 2;

    expect(result.shortLine.slice(0, firstShortIndex)).toEqual(
      Array(firstShortIndex).fill(undefined),
    );
    expect(result.longLine.slice(0, firstLongIndex)).toEqual(
      Array(firstLongIndex).fill(undefined),
    );
    expect(result.shortLine[firstShortIndex]).toBeCloseTo(20);
    expect(result.longLine[firstLongIndex]).toBeCloseTo(20);
    expect(result.value).toBe(1);
  });

  it('keeps ATR percent ratio stable for non-constant candles', () => {
    const data = Array.from({ length: 80 }, (_, i) => {
      const close = 100 + i * 0.7 + Math.sin(i / 3) * 2;
      const volume = 1000 + i * 7;

      return {
        timestamp: i * 60_000,
        open: close - 0.4 + Math.cos(i / 5) * 0.2,
        high: close + 1.5 + (i % 4) * 0.2,
        low: close - 1.2 - (i % 3) * 0.15,
        close,
        volume,
        turnover: volume * close,
      };
    }) as any[];

    const result = ATR_PCT(data, 14, 7, 30);

    expect(result.shortLine.findIndex((value) => value != null)).toBe(19);
    expect(result.longLine.findIndex((value) => value != null)).toBe(42);
    expect(result.shortLine[19]).toBeCloseTo(2.8770132324260085, 12);
    expect(result.shortLine.at(-1)).toBeCloseTo(2.0758020297858772, 12);
    expect(result.longLine[42]).toBeCloseTo(2.659797383147776, 12);
    expect(result.longLine.at(-1)).toBeCloseTo(2.195626920492721, 12);
    expect(result.value).toBe(0.95);
  });
});
