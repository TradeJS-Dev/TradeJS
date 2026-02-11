import { createIndicators } from '../indicators';
import { Candle } from '@types';

const INTERVAL_MS = 15 * 60_000;

const makeCandle = (timestamp: number, close: number): Candle => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
  turnover: close * 1000,
});

describe('TrendLine indicators pct windows', () => {
  it('computes price1hPcnt and price24hPcnt when window is full', () => {
    const indicators = createIndicators([]);
    const results: Array<ReturnType<typeof indicators.next> | null> = [];

    const baseClose = 100;
    for (let i = 0; i < 100; i += 1) {
      const candle = makeCandle(i * INTERVAL_MS, baseClose + i);
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

  it('computes price24hPcnt before the 24h window is complete', () => {
    const indicators = createIndicators([]);
    const results: Array<ReturnType<typeof indicators.next> | null> = [];

    const baseClose = 100;
    for (let i = 0; i < 90; i += 1) {
      const candle = makeCandle(i * INTERVAL_MS, baseClose + i);
      results.push(indicators.next(candle));
    }

    const idx = 80;
    const res = results[idx];
    expect(res).toBeTruthy();
    expect(res?.price24hPcnt).not.toBeNull();
  });

  it('does not anchor price1hPcnt to current candle on coarse timeframe', () => {
    const indicators = createIndicators([]);
    const results: Array<ReturnType<typeof indicators.next> | null> = [];

    const FOUR_HOURS_MS = 4 * 60 * 60_000;
    const baseClose = 100;
    for (let i = 0; i < 80; i += 1) {
      const candle = makeCandle(i * FOUR_HOURS_MS, baseClose + i);
      results.push(indicators.next(candle));
    }

    const last = results[results.length - 1];
    expect(last).toBeTruthy();
    expect(last?.price1hPcnt).not.toBe(0);
  });
});
