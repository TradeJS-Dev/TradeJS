import { Candle } from '@types';
import { createIndicators } from '../indicators';

const INTERVAL_15M_MS = 15 * 60_000;

const makeCandle = (
  timestamp: number,
  close: number,
  high = close,
  low = close,
): Candle => ({
  timestamp,
  open: close,
  high,
  low,
  close,
  volume: 1000,
  turnover: close * 1000,
});

describe('utils indicators', () => {
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
    expect(Array.isArray(result.candles15m)).toBe(true);
    expect(result.candles15m).toHaveLength(50);
    expect(Array.isArray(result.btcCandles1h)).toBe(true);
    expect(result.btcCandles1h.length).toBeLessThanOrEqual(50);
    expect(Array.isArray(result.maFast1h)).toBe(true);
    expect(result.maFast1h.length).toBeGreaterThan(0);
    expect(Array.isArray(result.btcMaFast)).toBe(true);
    expect(Array.isArray(result.btcMaFast1h)).toBe(true);
    expect(Array.isArray(result.btcAtrPct4h)).toBe(true);
  });
});
