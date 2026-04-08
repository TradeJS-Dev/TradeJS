import { buildTrendlineTimingContext } from '../guardrails';

const makeCandle = (
  timestamp: number,
  { close, high, low }: { close: number; high?: number; low?: number },
) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: close,
  close,
  high: high ?? close + 0.2,
  low: low ?? close - 0.2,
  volume: 100,
  turnover: close * 100,
});

const makeSignal = ({
  direction = 'LONG',
  currentPrice,
  points,
  atrPct,
}: {
  direction?: 'LONG' | 'SHORT';
  currentPrice: number;
  points: Array<{ timestamp: number; value: number }>;
  atrPct?: number[];
}) => ({
  direction,
  prices: { currentPrice },
  indicators: {
    atrPct: atrPct ?? [1, 1, 1, 1],
  },
  additionalIndicators: {
    touches: 5,
    distance: 80,
    trendLine: {
      id: 'line-1',
      mode: direction === 'LONG' ? 'lows' : 'highs',
      distance: 80,
      touches: [],
      points,
    },
  },
  figures: {},
});

describe('buildTrendlineTimingContext', () => {
  it('marks fresh breakout as ready_breakout', () => {
    const base = 1_700_000_000_000;
    const candles = [
      makeCandle(base, { close: 99.7, high: 100.0, low: 99.4 }),
      makeCandle(base + 900_000, { close: 100.8, high: 101.0, low: 100.4 }),
    ];

    const context = buildTrendlineTimingContext({
      signal: makeSignal({
        currentPrice: 100.8,
        points: [
          { timestamp: base, value: 99.8 },
          { timestamp: base + 900_000, value: 100.2 },
        ],
      }),
      candles,
    });

    expect(context.entryTiming).toBe('ready_breakout');
    expect(context.entryReadyNow).toBe(true);
    expect(context.breakoutFresh).toBe(true);
    expect(context.barsSinceLineCross).toBe(0);
    expect(context.lineSlopeDirection).toBe('rising');
    expect(context.lineSlopeAligned).toBe(true);
  });

  it('marks stale breakout without retest as stale_breakout', () => {
    const base = 1_700_000_000_000;
    const candles = [
      makeCandle(base, { close: 100.8, high: 101.0, low: 100.4 }),
      makeCandle(base + 900_000, { close: 100.9, high: 101.1, low: 100.5 }),
      makeCandle(base + 1_800_000, { close: 101.0, high: 101.2, low: 100.6 }),
    ];

    const context = buildTrendlineTimingContext({
      signal: makeSignal({
        currentPrice: 101.0,
        points: [
          { timestamp: base, value: 100.0 },
          { timestamp: base + 1_800_000, value: 100.0 },
        ],
      }),
      candles,
    });

    expect(context.entryTiming).toBe('stale_breakout');
    expect(context.entryReadyNow).toBe(false);
    expect(context.staleBreakout).toBe(true);
    expect(context.barsSinceLineCross).toBe(2);
  });

  it('marks retest-confirmed setup as ready_retest', () => {
    const base = 1_700_000_000_000;
    const candles = [
      makeCandle(base, { close: 99.4, high: 99.7, low: 99.1 }),
      makeCandle(base + 900_000, { close: 100.6, high: 100.9, low: 100.3 }),
      makeCandle(base + 1_800_000, { close: 100.05, high: 100.3, low: 99.9 }),
      makeCandle(base + 2_700_000, { close: 100.7, high: 101.0, low: 100.4 }),
    ];

    const context = buildTrendlineTimingContext({
      signal: makeSignal({
        currentPrice: 100.7,
        points: [
          { timestamp: base, value: 100.0 },
          { timestamp: base + 2_700_000, value: 100.0 },
        ],
      }),
      candles,
    });

    expect(context.retestHappened).toBe(true);
    expect(context.retestConfirmed).toBe(true);
    expect(context.entryTiming).toBe('ready_retest');
    expect(context.entryReadyNow).toBe(true);
    expect(context.barsSinceRetest).toBe(1);
  });
});
