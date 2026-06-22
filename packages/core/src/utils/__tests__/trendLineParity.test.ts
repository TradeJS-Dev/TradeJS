import { KLineData } from 'klinecharts';
import { createTrendlineEngine } from '../trendLine/engine';
import {
  findTrendlinesByHighs,
  findTrendlinesByLows,
} from '../testHelpers/trendLine/referenceCore';

const buildCandles = (length: number, trend: 'up' | 'down'): KLineData[] => {
  const start = 1_700_100_000_000;
  const step = 60_000;
  const data: KLineData[] = [];

  for (let i = 0; i < length; i += 1) {
    const direction = trend === 'up' ? 1 : -1;
    const base = 100 + direction * i * 0.5;
    const dip = i % 10 === 0 ? 5 : 0;
    const spike = i % 10 === 5 ? 5 : 0;
    const extraSwing = i === length - 1 ? 8 : 0;
    const low = base - dip - extraSwing;
    const high = base + spike + extraSwing;
    const open = base;
    const close = base;

    data.push({
      timestamp: start + i * step,
      open,
      high,
      low,
      close,
      volume: 1,
      turnover: 1,
    } as KLineData);
  }

  return data;
};

const roundValue = (value: number, precision = 6) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const normalizeLines = (
  lines: Array<{
    mode: string;
    distance: number;
    points: { timestamp: number; value: number }[];
    touches: { timestamp: number; value: number }[];
  }>,
) =>
  lines
    .map((line) => ({
      mode: line.mode,
      distance: roundValue(line.distance),
      points: line.points.map((point) => ({
        timestamp: point.timestamp,
        value: roundValue(point.value),
      })),
      touches: line.touches.map((touch) => ({
        timestamp: touch.timestamp,
        value: roundValue(touch.value),
      })),
    }))
    .sort(
      (a, b) =>
        a.points[0].timestamp - b.points[0].timestamp ||
        a.points[1].timestamp - b.points[1].timestamp,
    );

const expectParityForMode = (
  mode: 'lows' | 'highs',
  data: KLineData[],
  options: any,
) => {
  const engine = createTrendlineEngine([], { mode, ...options });
  engine.nextMany(data);
  const engineLines = engine.getLines();

  const batchLines =
    mode === 'lows'
      ? findTrendlinesByLows(data, options)
      : findTrendlinesByHighs(data, options);

  expect(engineLines.length).toBeGreaterThan(0);
  expect(normalizeLines(engineLines)).toEqual(normalizeLines(batchLines));
};

const expectParityForModeStreaming = (
  mode: 'lows' | 'highs',
  data: KLineData[],
  options: any,
) => {
  const engine = createTrendlineEngine([], { mode, ...options });
  for (const candle of data) {
    engine.next(candle);
  }
  const engineLines = engine.getLines();

  const batchLines =
    mode === 'lows'
      ? findTrendlinesByLows(data, options)
      : findTrendlinesByHighs(data, options);

  expect(engineLines.length).toBeGreaterThan(0);
  expect(normalizeLines(engineLines)).toEqual(normalizeLines(batchLines));
};

const expectBatchAndStreamingParity = (
  mode: 'lows' | 'highs',
  data: KLineData[],
  options: any,
) => {
  const batchEngine = createTrendlineEngine([], { mode, ...options });
  batchEngine.nextMany(data);

  const streamingEngine = createTrendlineEngine([], { mode, ...options });
  for (const candle of data) {
    streamingEngine.next(candle);
  }

  expect(normalizeLines(batchEngine.getLines())).toEqual(
    normalizeLines(streamingEngine.getLines()),
  );
};

const expectSignalsStyleParity = (
  mode: 'lows' | 'highs',
  data: KLineData[],
  options: any,
) => {
  const batchEngine = createTrendlineEngine([], { mode, ...options });
  batchEngine.nextMany(data);

  const preloadEngine = createTrendlineEngine(data.slice(0, -1), {
    mode,
    ...options,
  });
  preloadEngine.next(data[data.length - 1]);

  expect(normalizeLines(preloadEngine.getLines())).toEqual(
    normalizeLines(batchEngine.getLines()),
  );
};

describe('trendLine vs trendLineEngine parity', () => {
  const lowsData = buildCandles(80, 'up');
  const highsData = buildCandles(80, 'down');

  it('matches results for capture=false', () => {
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: false,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    expectParityForMode('lows', lowsData, options);
    expectParityForMode('highs', highsData, options);
  });

  it('matches results when streaming candles via next()', () => {
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: false,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    expectParityForModeStreaming('lows', lowsData, options);
    expectParityForModeStreaming('highs', highsData, options);
  });

  it('matches results for capture=true', () => {
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: true,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    expectParityForMode('lows', lowsData, options);
    expectParityForMode('highs', highsData, options);
  });

  it('keeps batch nextMany() equivalent to streaming next()', () => {
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: true,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    expectBatchAndStreamingParity('lows', lowsData, options);
    expectBatchAndStreamingParity('highs', highsData, options);
  });

  it('keeps preload-then-last-candle flow equivalent to full preload', () => {
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: true,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
    };

    expectSignalsStyleParity('lows', lowsData, options);
    expectSignalsStyleParity('highs', highsData, options);
  });

  it('keeps ATR epsilon mode deterministic across engine flows', () => {
    const options = {
      range: 2,
      firstRange: 2,
      minTouches: 2,
      minDistance: 8,
      minTouchGap: 2,
      maxTouchGap: 50,
      offset: 5,
      capture: true,
      bestLines: 5,
      maxLines: 50,
      maxDistance: 200,
      epsilon: 0.001,
      epsilonOffset: 0.001,
      epsilonMode: 'atr',
      epsilonAtrPeriod: 5,
      epsilonAtrMultiplier: 0.15,
      epsilonOffsetAtrMultiplier: 0.15,
      epsilonMin: 0.001,
      epsilonMax: 0.01,
      epsilonOffsetMin: 0.001,
      epsilonOffsetMax: 0.01,
    };

    expectBatchAndStreamingParity('lows', lowsData, options);
    expectBatchAndStreamingParity('highs', highsData, options);
    expectSignalsStyleParity('lows', lowsData, options);
    expectSignalsStyleParity('highs', highsData, options);
  });
});
