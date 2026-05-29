/** @jest-environment node */

import { config as DEFAULT_CONFIG } from '../config';
import { createAdaptiveTrendChannelEngine } from '../engine';

const makeCandle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000 + index * 100,
  turnover: close * (1_000 + index * 100),
});

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    ADAPTIVE_TREND_CHANNEL_REGRESSION_BARS: 2,
    ADAPTIVE_TREND_CHANNEL_ENVELOPE_BARS: 2,
    ADAPTIVE_TREND_CHANNEL_VOLATILITY_LOOKBACK: 2,
    ADAPTIVE_TREND_CHANNEL_ATR_STRETCH: 1,
    ...overrides,
  }) as any;

describe('AdaptiveTrendChannel engine', () => {
  it('builds channel state and figure series once history is ready', () => {
    const engine = createAdaptiveTrendChannelEngine({ config: makeConfig() });
    const candles = [
      makeCandle(0, 100, 101, 99, 100),
      makeCandle(1, 101, 102, 100, 101),
      makeCandle(2, 102, 103, 101, 102),
      makeCandle(3, 103, 104, 102, 103),
      makeCandle(4, 104, 105, 103, 104),
    ];

    const states = candles.map((candle) => engine.next(candle as any));
    const latest = states[states.length - 1];

    expect(latest.snapshot?.regime).toBe(1);
    expect(latest.snapshot?.centerline).toBeGreaterThan(0);
    expect(latest.series.centerline.length).toBeGreaterThan(0);
    expect(latest.series.roof.length).toBeGreaterThan(0);
    expect(latest.series.floor.length).toBeGreaterThan(0);
  });

  it('processes long histories without retaining unbounded figure series', () => {
    const maxFigurePoints = 64;
    const engine = createAdaptiveTrendChannelEngine({
      config: makeConfig({
        ADAPTIVE_TREND_CHANNEL_REGRESSION_BARS: 10,
        ADAPTIVE_TREND_CHANNEL_ENVELOPE_BARS: 2,
        ADAPTIVE_TREND_CHANNEL_VOLATILITY_LOOKBACK: 100,
        ADAPTIVE_TREND_CHANNEL_MAX_FIGURE_POINTS: maxFigurePoints,
      }),
    });

    let latest = engine.getState();
    for (let index = 0; index < 40_000; index += 1) {
      const base = 100 + Math.sin(index / 20) * 3 + index * 0.001;
      latest = engine.next(
        makeCandle(
          index,
          base,
          base + 1 + Math.sin(index / 17) * 0.2,
          base - 1 - Math.cos(index / 19) * 0.2,
          base + Math.sin(index / 11) * 0.5,
        ) as any,
      );
    }

    expect(latest.snapshot?.centerline).toBeGreaterThan(0);
    expect(latest.series.centerline.length).toBeLessThanOrEqual(
      maxFigurePoints,
    );
    expect(latest.series.roof.length).toBeLessThanOrEqual(maxFigurePoints);
    expect(latest.series.floor.length).toBeLessThanOrEqual(maxFigurePoints);
  });
});
