import { buildReverseTrendlineStructuralContext } from '../guardrails';

const makeSignal = ({
  direction = 'LONG',
  currentPrice,
  currentCandle,
  points,
}: {
  direction?: 'LONG' | 'SHORT';
  currentPrice: number;
  currentCandle: {
    timestamp: number;
    open: number;
    close: number;
    high: number;
    low: number;
  };
  points: Array<{ timestamp: number; value: number }>;
}) => ({
  direction,
  prices: { currentPrice },
  indicators: {
    atrPct: [1],
    maFast: direction === 'LONG' ? [101] : [99],
    maSlow: [100],
    btcMaFast: direction === 'LONG' ? [101] : [99],
    btcMaSlow: [100],
  },
  additionalIndicators: {
    touches: 5,
    distance: 120,
    currentCandle,
    trendLine: {
      id: 'line-1',
      mode: direction === 'LONG' ? 'lows' : 'highs',
      distance: 120,
      touches: [],
      points,
    },
  },
  figures: {},
});

describe('buildReverseTrendlineStructuralContext', () => {
  it('evaluates current line price at current candle timestamp', () => {
    const timestamp = 3_000;
    const context = buildReverseTrendlineStructuralContext(
      makeSignal({
        currentPrice: 104.2,
        currentCandle: {
          timestamp,
          open: 103.6,
          close: 104.2,
          high: 104.4,
          low: 103.4,
        },
        points: [
          { timestamp: 2_000, value: 102 },
          { timestamp: 1_000, value: 100 },
        ],
      }),
    );

    expect(context.currentLinePrice).toBeCloseTo(104, 8);
    expect(context.priceVsLinePct).toBeCloseTo(((104.2 - 104) / 104) * 100, 8);
    expect(context.lineTouchedNow).toBe(true);
  });

  it('uses sorted line geometry even when points are not ordered', () => {
    const timestamp = 3_000;
    const context = buildReverseTrendlineStructuralContext(
      makeSignal({
        direction: 'SHORT',
        currentPrice: 105.8,
        currentCandle: {
          timestamp,
          open: 106.3,
          close: 105.8,
          high: 106.5,
          low: 105.6,
        },
        points: [
          { timestamp: 3_000, value: 106 },
          { timestamp: 1_000, value: 100 },
          { timestamp: 2_000, value: 103 },
        ],
      }),
    );

    expect(context.currentLinePrice).toBeCloseTo(106, 8);
    expect(context.closeOnBounceSide).toBe(true);
    expect(context.failedBounceBreak).toBe(false);
  });
});
