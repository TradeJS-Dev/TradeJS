import { act, renderHook } from '@testing-library/react';
import type { Chart, OverlayCreate } from 'klinecharts';
import type { KlineChartItem, OrderLog } from '@tradejs/types';
import { useBacktest } from '../hooks/useBacktest';
import { createBacktestMarkersPointFigure } from '../figures/backtestMarkersPointFigure';

jest.mock('klinecharts', () => ({
  registerOverlay: jest.fn(),
  registerIndicator: jest.fn(),
  registerFigure: jest.fn(),
}));

const candle: KlineChartItem = {
  timestamp: 100,
  open: 10,
  high: 11,
  low: 9,
  close: 10,
  volume: 1,
  turnover: 10,
  dt: '',
};
const order: OrderLog = {
  index: 0,
  type: 'OPEN_LONG',
  symbol: 'BTCUSDT',
  direction: 'LONG',
  price: 10,
  qty: 1,
  amount: 100,
  profit: -1,
  timestamp: 100,
};

it('renders both runs on the same candles, forwards marker clicks and removes only the comparison', () => {
  const createOverlay = jest.fn((overlay: OverlayCreate) => overlay.id);
  const removeOverlay = jest.fn();
  const removeIndicator = jest.fn();
  const chart = {
    createOverlay,
    removeOverlay,
    createIndicator: jest.fn(),
    removeIndicator,
  } as unknown as Chart;
  const select = jest.fn();
  const candles = [candle];
  const orders = [order];
  const empty: OrderLog[] = [];
  const { rerender } = renderHook(
    ({ compared }) => {
      useBacktest(chart, candles, orders, 'A', true, select);
      useBacktest(chart, candles, compared ? orders : empty, 'B', true, select);
    },
    { initialProps: { compared: true } },
  );

  const [primary, comparison] = createOverlay.mock.calls.map(
    ([overlay]) => overlay,
  );
  expect(primary.points).toEqual(comparison.points);
  const [marker, label] = createBacktestMarkersPointFigure({
    coordinates: [{ x: 100, y: 120 }],
    overlay: { extendData: comparison.extendData as never },
  });
  expect(label.attrs).toMatchObject({ text: 'B · OPEN_LONG -1.00' });
  act(() =>
    comparison.onClick?.({
      figure: marker,
      overlay: comparison as never,
      chart,
    }),
  );
  expect(select).toHaveBeenCalledWith('B', 0);

  rerender({ compared: false });
  expect(removeOverlay).toHaveBeenCalledTimes(1);
  expect(removeOverlay).toHaveBeenCalledWith({ groupId: 'backtest-B' });
  expect(removeIndicator).toHaveBeenCalledWith({ id: 'BacktestProfitB' });
});
