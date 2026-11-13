import { renderHook } from '@testing-library/react';
import type { ActionCallback, ActionType, Chart } from 'klinecharts';
import { useLinkedCharts } from '../LinkedChart';

jest.mock('#store', () => ({ useData: jest.fn() }));

const chart = (timestamps: number[]) => {
  const root = document.createElement('div');
  const handlers = new Map<ActionType, ActionCallback>();
  const mock = {
    getDom: () => root,
    getDataList: () =>
      timestamps.map((timestamp) => ({ timestamp, close: 10 })),
    getVisibleRange: () => ({ from: 0, to: timestamps.length }),
    getSize: () => ({ width: 500 }),
    convertFromPixel: jest.fn(() => [{ timestamp: timestamps[1] }]),
    convertToPixel: jest.fn(() => ({ x: 100, y: 20 })),
    executeAction: jest.fn(),
    setBarSpace: jest.fn(),
    scrollToDataIndex: jest.fn(),
    subscribeAction: (action: ActionType, callback: ActionCallback) =>
      handlers.set(action, callback),
    unsubscribeAction: (action: ActionType, callback: ActionCallback) => {
      if (handlers.get(action) === callback) handlers.delete(action);
    },
  };
  return { mock, chart: mock as unknown as Chart, handlers, root };
};

it('synchronizes time and crosshair in both directions and unsubscribes on close', () => {
  const primary = chart([100, 200, 300, 400]);
  const secondary = chart([100, 300]);
  const { unmount } = renderHook(() =>
    useLinkedCharts(primary.chart, secondary.chart),
  );

  expect(secondary.mock.scrollToDataIndex).toHaveBeenCalledWith(1);
  primary.handlers.get('onCrosshairChange')?.({ x: 10 });
  expect(secondary.mock.convertToPixel).toHaveBeenCalledWith({
    timestamp: 100,
    value: 10,
  });
  expect(secondary.mock.executeAction).toHaveBeenCalledWith(
    'onCrosshairChange',
    { x: 100, y: 20, paneId: 'candle_pane' },
  );
  secondary.handlers.get('onCrosshairChange')?.({ x: 10 });
  expect(primary.mock.convertToPixel).toHaveBeenCalledWith({
    timestamp: 300,
    value: 10,
  });
  secondary.handlers.get('onZoom')?.();
  expect(primary.mock.setBarSpace).toHaveBeenCalled();
  primary.root.dispatchEvent(new MouseEvent('mouseleave'));
  expect(secondary.mock.executeAction).toHaveBeenLastCalledWith(
    'onCrosshairChange',
    expect.objectContaining({ x: -100 }),
  );

  unmount();
  expect(primary.handlers.size).toBe(0);
  expect(secondary.handlers.size).toBe(0);
});
