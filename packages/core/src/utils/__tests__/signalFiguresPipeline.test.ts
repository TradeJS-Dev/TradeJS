import { Signal, TrendLine } from '@tradejs/types';
const mockRegisterOverlay = jest.fn();

jest.mock('klinecharts', () => ({
  Chart: class {},
  registerOverlay: (overlay: unknown) => mockRegisterOverlay(overlay),
}));

import {
  collectSignalFiguresFromOrderLog,
  convertTrendLineToFigures,
  drawSignalFigures,
  ensureBaseFigureOverlaysRegistered,
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers base overlays only once', () => {
    ensureBaseFigureOverlaysRegistered();
    ensureBaseFigureOverlaysRegistered();

    expect(mockRegisterOverlay).toHaveBeenCalledTimes(4);
  });

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

  it('normalizes entry evidence annotations', () => {
    const signal = makeSignal({
      figures: {
        annotations: [
          {
            id: 'evidence',
            point: { timestamp: 2, value: 101 },
            title: 'Relative rotation LONG',
            items: ['Alpha 24h: 1.2%'],
          },
        ],
      },
    });

    const normalized = normalizeSignalFigures(signal);
    expect(normalized?.annotations).toEqual(signal.figures.annotations);
    expect(normalized?.lines).toBeUndefined();
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

  it('returns undefined when figures are empty or signal is missing', () => {
    const withEmptyFigures = normalizeSignalFigures(
      makeSignal({
        figures: {
          lines: [],
          points: [],
          zones: [],
        },
      }),
    );
    const withoutSignal = normalizeSignalFigures(undefined);

    expect(withEmptyFigures).toBeUndefined();
    expect(withoutSignal).toBeUndefined();
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

  it('keeps OPEN signals without signalId as separate entries', () => {
    const signalA = makeSignal({
      signalId: undefined as any,
      figures: { trendLine: makeTrendLine() },
    });
    const signalB = makeSignal({
      signalId: undefined as any,
      timestamp: 2_100,
      figures: { trendLine: makeTrendLine() },
    });
    const orderLog = [
      {
        type: 'OPEN_LONG',
        signal: signalA,
        timestamp: 1,
        price: 100,
        profit: 0,
        amount: 1,
        index: 1,
      },
      {
        type: 'OPEN_LONG',
        signal: signalB,
        timestamp: 2,
        price: 101,
        profit: 0,
        amount: 1,
        index: 2,
      },
    ] as any;

    const collected = collectSignalFiguresFromOrderLog(orderLog);
    expect(collected).toHaveLength(2);
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
        annotations: [
          {
            id: 'a1',
            point: { timestamp: 2, value: 2 },
            title: 'Entry evidence',
            items: ['Momentum crossed zero'],
          },
        ],
      },
    });

    expect(chart.createOverlay).toHaveBeenCalledTimes(4);
    expect(chart.createOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'BacktestEntryAnnotation',
        id: 'id1-annotation-a1',
      }),
    );
    removeSignalFigures(chart, overlays);
    expect(chart.removeOverlay).toHaveBeenCalledTimes(4);
  });

  it('keeps every point of multi-point pattern lines', () => {
    const chart = {
      createOverlay: jest.fn(),
      removeOverlay: jest.fn(),
    } as any;
    const patternPoints = [
      { timestamp: 1, value: 10 },
      { timestamp: 2, value: 8 },
      { timestamp: 3, value: 11 },
      { timestamp: 4, value: 9 },
      { timestamp: 5, value: 12 },
    ];

    const overlays = drawSignalFigures({
      chart,
      idPrefix: 'doubletap',
      figures: {
        lines: [
          {
            id: 'pattern',
            kind: 'doubletap_double_bottom_pattern',
            points: patternPoints,
          },
        ],
      },
    });

    expect(chart.createOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'BacktestEntryLine',
        id: 'doubletap-line-pattern',
        points: patternPoints,
      }),
    );
    expect(overlays).toEqual([
      { name: 'BacktestEntryLine', id: 'doubletap-line-pattern' },
    ]);
  });

  it('skips invalid line/point overlays and uses index fallback ids', () => {
    const chart = {
      createOverlay: jest.fn(),
      removeOverlay: jest.fn(),
    } as any;

    const overlays = drawSignalFigures({
      chart,
      idPrefix: 'id2',
      figures: {
        lines: [{ points: [{ timestamp: 1, value: 1 }] }],
        points: [{ points: [] }],
        zones: [
          {
            start: { timestamp: 1, value: 1 },
            end: { timestamp: 2, value: 2 },
          },
        ],
      },
    });

    expect(chart.createOverlay).toHaveBeenCalledTimes(1);
    expect(overlays).toEqual([{ name: 'BacktestEntryZone', id: 'id2-zone-0' }]);
  });
});
