import { renderHook, waitFor } from '@testing-library/react';
import {
  drawSignalFigures,
  normalizeSignalFigures,
  removeSignalFigures,
} from '@tradejs/core/figures';
import { useSignalFigures } from '../useSignal';
import { useTradeSetup } from '../useSetup';

jest.mock('klinecharts', () => ({
  registerOverlay: jest.fn(),
}));

jest.mock('@tradejs/core/figures', () => ({
  drawSignalFigures: jest.fn(() => [
    { name: 'BacktestEntryLine', id: 'line-1' },
  ]),
  ensureBaseFigureOverlaysRegistered: jest.fn(),
  normalizeSignalFigures: jest.fn(),
  removeSignalFigures: jest.fn(),
}));

const signal = {
  signalId: 'signal-1',
  strategy: 'DoubleTap',
  symbol: 'BTCUSDT',
  interval: '15',
  direction: 'LONG',
  timestamp: 2,
  figures: {
    lines: [
      {
        id: 'line-1',
        points: [
          { timestamp: 1, value: 100 },
          { timestamp: 2, value: 102 },
        ],
      },
    ],
  },
  indicators: {},
  prices: {
    currentPrice: 102,
    takeProfitPrice: 110,
    stopLossPrice: 98,
    riskRatio: 2,
  },
} as any;

const chart = {
  createOverlay: jest.fn(),
  getSize: jest.fn(() => ({ width: 800 })),
  getSymbol: jest.fn(() => ({ ticker: 'BTCUSDT' })),
  removeOverlay: jest.fn(),
  scrollToTimestamp: jest.fn(),
  setOffsetRightDistance: jest.fn(),
  zoomAtTimestamp: jest.fn(),
} as any;

describe('dashboard signal overlays', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (normalizeSignalFigures as jest.Mock).mockReturnValue(signal.figures);
  });

  it('marks figures ready only after drawing the supplied signal', async () => {
    const { result, unmount } = renderHook(() =>
      useSignalFigures({
        chart,
        lastDataTimestamp: 2,
        enabled: true,
        signal,
        autoZoom: true,
      }),
    );

    await waitFor(() => expect(result.current).toBe(true));
    expect(drawSignalFigures).toHaveBeenCalledWith({
      chart,
      idPrefix: 'signal-signal-1',
      figures: signal.figures,
    });
    expect(chart.scrollToTimestamp).toHaveBeenCalledWith(2_000);

    unmount();
    expect(removeSignalFigures).toHaveBeenCalledWith(chart, [
      { name: 'BacktestEntryLine', id: 'line-1' },
    ]);
  });

  it('marks TP/SL setup ready only after creating all overlays', async () => {
    const { result } = renderHook(() =>
      useTradeSetup({ chart, enabled: true, signal }),
    );

    await waitFor(() => expect(result.current).toBe(true));
    expect(chart.createOverlay).toHaveBeenCalledTimes(3);
    expect(chart.createOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Setup',
        id: 'signal-1-tp',
      }),
    );
    expect(chart.createOverlay).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Setup',
        id: 'signal-1-sl',
      }),
    );
  });
});
