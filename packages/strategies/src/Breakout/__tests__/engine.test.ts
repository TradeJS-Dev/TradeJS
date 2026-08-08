import { config as DEFAULT_CONFIG } from '../config';
import { createBreakoutEngine } from '../engine';

const makeCandle = (index: number, close: number) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    BREAKOUT_USE_ENGINE: true,
    BREAKOUT_ENGINE_LOOKBACK: 20,
    BREAKOUT_ENGINE_DELAY: 1,
    ...overrides,
  }) as any;

describe('Breakout engine', () => {
  it('emits a one-bar signal on a fresh Donchian close breakout', () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      makeCandle(index, 100),
    );
    const engine = createBreakoutEngine({
      config: makeConfig(),
      initialCandles: history as any,
    });

    expect(engine.next(makeCandle(20, 103) as any).signal).toMatchObject({
      direction: 'LONG',
      breakoutLevel: 101,
      lookback: 20,
      delay: 1,
    });
    expect(engine.next(makeCandle(21, 103.5) as any).signal).toBeNull();
  });

  it('rebuilds the same transition from initial candles', () => {
    const history = Array.from({ length: 20 }, (_, index) =>
      makeCandle(index, 100),
    );
    const nextCandle = makeCandle(20, 103) as any;
    const continuous = createBreakoutEngine({ config: makeConfig() });
    for (const candle of history) {
      continuous.next(candle as any);
    }
    const restored = createBreakoutEngine({
      config: makeConfig(),
      initialCandles: history as any,
    });

    expect(restored.next(nextCandle)).toEqual(continuous.next(nextCandle));
    expect(restored.getState()).toEqual(continuous.getState());
  });
});
