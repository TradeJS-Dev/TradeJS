import { Signal, TrendLine } from '@types';
import {
  collectSignalFiguresFromOrderLog,
  convertTrendLineToFigures,
  drawSignalFigures,
  normalizeSignalFigures,
  removeSignalFigures,
} from '../figures/signalFiguresPipeline';

const makeTrendLine = (): TrendLine => ({
  id: 'tl-1',
  mode: 'lows',
  distance: 1.2,
  points: [
    { timestamp: 1_000, value: 100 },
    { timestamp: 2_000, value: 101 },
  ],
  touches: [{ timestamp: 1_500, value: 100.5 }],
});

const makeSignal = (overrides: Partial<Signal> = {}): Signal => ({
  signalId: 's1',
  symbol: 'BTCUSDT',
  interval: '15' as any,
  strategy: 'TrendLine',
  direction: 'LONG',
  timestamp: 2_000,
  prices: {
    currentPrice: 100,
    takeProfitPrice: 105,
    stopLossPrice: 95,
    riskRatio: 2,
  },
  figures: {},
  indicators: {},
  ...overrides,
});

describe('signalFiguresPipeline', () => {
  it('converts legacy trendLine figure to base lines/points', () => {
    const converted = convertTrendLineToFigures(makeTrendLine());

    expect(converted.lines).toHaveLength(1);
    expect(converted.points).toHaveLength(1);
    expect(converted.lines?.[0]?.points).toHaveLength(2);
    expect(converted.points?.[0]?.points).toHaveLength(3);
  });

  it('normalizes direct base figures', () => {
    const signal = makeSignal({
      figures: {
        lines: [
          {
            points: [
              { timestamp: 1, value: 1 },
              { timestamp: 2, value: 2 },
            ],
          },
        ],
      },
    });

    const normalized = normalizeSignalFigures(signal);
    expect(normalized?.lines).toHaveLength(1);
    expect(normalized?.points).toBeUndefined();
  });

  it('normalizes legacy trendLine figure', () => {
    const signal = makeSignal({
      figures: {
        trendLine: makeTrendLine(),
      },
    });

    const normalized = normalizeSignalFigures(signal);
    expect(normalized?.lines).toHaveLength(1);
    expect(normalized?.points).toHaveLength(1);
  });

  it('collects only OPEN_* events and de-duplicates by signalId', () => {
    const signal = makeSignal({ figures: { trendLine: makeTrendLine() } });
    const orderLog = [
      {
        type: 'OPEN_LONG',
        signal,
        timestamp: 1,
        price: 100,
        profit: 0,
        amount: 1,
        index: 1,
      },
      {
        type: 'OPEN_LONG',
        signal,
        timestamp: 2,
        price: 101,
        profit: 0,
        amount: 1,
        index: 2,
      },
      {
        type: 'CLOSE_LONG',
        signal,
        timestamp: 3,
        price: 102,
        profit: 2,
        amount: 1,
        index: 3,
      },
    ] as any;

    const collected = collectSignalFiguresFromOrderLog(orderLog);
    expect(collected).toHaveLength(1);
  });

  it('draws and removes overlays through chart api', () => {
    const chart = {
      createOverlay: jest.fn(),
      removeOverlay: jest.fn(),
    } as any;

    const overlays = drawSignalFigures({
      chart,
      idPrefix: 'id1',
      figures: {
        lines: [
          {
            id: 'l1',
            points: [
              { timestamp: 1, value: 1 },
              { timestamp: 2, value: 2 },
            ],
          },
        ],
        points: [{ id: 'p1', points: [{ timestamp: 1, value: 1 }] }],
        zones: [
          {
            id: 'z1',
            start: { timestamp: 1, value: 1 },
            end: { timestamp: 2, value: 2 },
          },
        ],
      },
    });

    expect(chart.createOverlay).toHaveBeenCalledTimes(3);
    removeSignalFigures(chart, overlays);
    expect(chart.removeOverlay).toHaveBeenCalledTimes(3);
  });
});
