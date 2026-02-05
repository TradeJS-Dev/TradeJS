import { KLineData } from 'klinecharts';
import { createTrendlineEngine } from '@utils/trendLineEngine';
import { findTrendlinesByHighs, findTrendlinesByLows } from '@utils/trendLine';

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
});
