import { createStrategyIndicatorsState } from '../indicators';

const INTERVAL_15M_MS = 15 * 60_000;

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1000,
  turnover: close * 1000,
});

describe('strategy indicators state snapshot integration', () => {
  it('keeps lazy snapshot fields stable after the next bar is applied', () => {
    const data = Array.from({ length: 140 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 140 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );

    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data as any,
      btcData: btcData as any,
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

    const first = state.snapshot() as Record<string, any>;

    state.next(
      makeCandle(140 * INTERVAL_15M_MS, 500),
      makeCandle(140 * INTERVAL_15M_MS, 25_000),
    );

    const second = state.snapshot() as Record<string, any>;

    expect(first.candles15m).toHaveLength(50);
    expect(first.candles15m[first.candles15m.length - 1].timestamp).toBe(
      139 * INTERVAL_15M_MS,
    );
    expect(second.candles15m[second.candles15m.length - 1].timestamp).toBe(
      140 * INTERVAL_15M_MS,
    );
    expect(first.candles15m).not.toBe(second.candles15m);
    expect(first.btcCandles15m[first.btcCandles15m.length - 1].timestamp).toBe(
      139 * INTERVAL_15M_MS,
    );
    expect(
      second.btcCandles15m[second.btcCandles15m.length - 1].timestamp,
    ).toBe(140 * INTERVAL_15M_MS);
  });

  it('keeps spread materialization compatible with signal payload usage', () => {
    const data = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 100 + index),
    );
    const btcData = Array.from({ length: 160 }, (_, index) =>
      makeCandle(index * INTERVAL_15M_MS, 20_000 + index),
    );

    const state = createStrategyIndicatorsState({
      env: 'BACKTEST',
      data: data as any,
      btcData: btcData as any,
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

    const snapshot = state.snapshot() as Record<string, any>;
    const spread = { ...snapshot };

    expect(Array.isArray(spread.maFast)).toBe(true);
    expect(Array.isArray(spread.btcMaFast)).toBe(true);
    expect(Array.isArray(spread.candles15m)).toBe(true);
    expect(Array.isArray(spread.btcCandles15m)).toBe(true);
    expect(Array.isArray(spread.maFast1h)).toBe(true);
    expect(Array.isArray(spread.btcMaFast1h)).toBe(true);
  });
});
