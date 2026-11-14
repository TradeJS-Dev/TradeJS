import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import type { KlineChartItem, OrderLog, OrderLogData } from '@tradejs/types';
import type { OverlayCreate } from 'klinecharts';
import { KlineChart } from '..';

const emptyOrders: OrderLogData = [];
const useBacktestMock = jest.fn((_id?: string) => ({
  backtest: emptyOrders,
  loading: false,
}));
let displayed: KlineChartItem[];
const canvasPane = document.createElement('div');

const useDataMock = jest.fn();
const useDashboardSignalMock = jest.fn();
const useSignalFiguresMock = jest.fn();
const useTradeSetupMock = jest.fn();
const searchParamsGetMock = jest.fn();
const setDataLoaderMock = jest.fn();
const setSymbolMock = jest.fn();
const setPeriodMock = jest.fn();

const chartMock = {
  getSymbol: jest.fn(),
  getPeriod: jest.fn(),
  setSymbol: setSymbolMock,
  setPeriod: setPeriodMock,
  setDataLoader: setDataLoaderMock,
  getDataList: jest.fn(() => displayed),
  getDom: () => canvasPane,
  convertFromPixel: jest.fn(),
  getSize: jest.fn(() => ({ width: 800 })),
  setBarSpace: jest.fn(),
  scrollToRealTime: jest.fn(),
  createOverlay: jest.fn((overlay: OverlayCreate) => overlay.id),
  overrideOverlay: jest.fn(() => false),
  removeOverlay: jest.fn(),
  getVisibleRange: jest.fn(() => ({ realTo: 0 })),
  scrollToDataIndex: jest.fn(),
};

jest.mock('klinecharts', () => ({
  init: () => chartMock,
  dispose: jest.fn(),
  registerOverlay: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchParamsGetMock }),
}));

jest.mock('#store', () => ({
  useData: (...args: unknown[]) => useDataMock(...args),
  useBacktest: (id?: string) => useBacktestMock(id),
}));

jest.mock('../hooks', () => ({
  useAtrIndicator: jest.fn(),
  useBacktest: jest.fn(),
  useBbIndicator: jest.fn(),
  useBtcCorrelation: jest.fn(),
  useBtcIndicator: jest.fn(),
  useEmaIndicator: jest.fn(),
  useMaIndicator: jest.fn(),
  useResize: jest.fn(),
  useDashboardSignal: (...args: unknown[]) => useDashboardSignalMock(...args),
  useSignalFigures: (...args: unknown[]) => useSignalFiguresMock(...args),
  useTradeSetup: (...args: unknown[]) => useTradeSetupMock(...args),
  useSpreadIndicator: jest.fn(),
  useSupportResistanceLines: jest.fn(),
  useVolIndicator: jest.fn(),
  useWmaIndicator: jest.fn(),
}));

jest.mock('../hooks/usePluginIndicators', () => ({
  usePluginIndicators: jest.fn(),
}));

jest.mock('../styles', () => ({
  darkTheme: jest.fn(),
}));

jest.mock('../ChartSkeleton', () => ({
  ChartSkeleton: () => <div role="status" />,
}));

const makeCandle = (timestamp: number, close: number): KlineChartItem => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
  turnover: 100,
  dt: new Date(timestamp).toISOString(),
});

const filters = {
  provider: 'bybit',
  universe: 'crypto',
  symbol: 'BTCUSDT',
  interval: '15',
  start: 1,
  end: 3,
  backtestId: null,
  backtestStrategy: null,
} as const;

const disabledIndicator = { enabled: false, periods: [] };
const indicators = {
  atr: disabledIndicator,
  bb: disabledIndicator,
  btc: disabledIndicator,
  btcCorrelation: disabledIndicator,
  ema: disabledIndicator,
  ma: disabledIndicator,
  resistant: disabledIndicator,
  spread: disabledIndicator,
  vol: disabledIndicator,
  wma: disabledIndicator,
};

describe('Dashboard/KlineChart', () => {
  const originalResizeObserver = global.ResizeObserver;
  beforeAll(() => {
    global.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });
  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    displayed = [];
    useBacktestMock.mockReturnValue({ backtest: emptyOrders, loading: false });
    let currentSymbol: string | undefined;
    let currentInterval: number | undefined;

    chartMock.getSymbol.mockImplementation(() =>
      currentSymbol ? { ticker: currentSymbol } : undefined,
    );
    chartMock.getPeriod.mockImplementation(() =>
      currentInterval ? { span: currentInterval } : undefined,
    );
    setSymbolMock.mockImplementation(({ ticker }) => {
      currentSymbol = ticker;
    });
    setPeriodMock.mockImplementation(({ span }) => {
      currentInterval = span;
    });
    setDataLoaderMock.mockImplementation(({ getBars, subscribeBar }) => {
      getBars({
        callback: (candles: KlineChartItem[]) => {
          displayed = candles;
        },
      });
      subscribeBar({
        callback: (candle: KlineChartItem) => {
          displayed.push(candle);
        },
      });
    });
    searchParamsGetMock.mockReturnValue(null);
    useDashboardSignalMock.mockReturnValue({
      queryKey: null,
      signal: null,
      status: 'idle',
    });
    useSignalFiguresMock.mockImplementation(({ enabled }) => enabled);
    useTradeSetupMock.mockImplementation(({ enabled }) => enabled);
  });

  it('waits for REST history before initializing the chart after an early websocket candle', () => {
    const liveCandle = makeCandle(3, 103);
    const history = [makeCandle(1, 101), makeCandle(2, 102), liveCandle];
    useDataMock.mockReturnValue({
      data: [liveCandle],
      key: 'bybit_crypto_BTCUSDT_15',
      fulfilled: false,
    });

    const { rerender } = render(
      <KlineChart
        id="test-chart"
        filters={filters as never}
        indicators={indicators as never}
        indicatorRenderers={{}}
      />,
    );

    expect(setDataLoaderMock).not.toHaveBeenCalled();

    useDataMock.mockReturnValue({
      data: history,
      key: 'bybit_crypto_BTCUSDT_15',
      fulfilled: true,
    });
    rerender(
      <KlineChart
        id="test-chart"
        filters={filters as never}
        indicators={indicators as never}
        indicatorRenderers={{}}
      />,
    );

    expect(setDataLoaderMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('market-chart').getAttribute('data-chart-ready'),
    ).toBe('true');
    const [{ getBars }] = setDataLoaderMock.mock.calls[0];
    const callback = jest.fn();
    act(() => getBars({ callback }));
    expect(callback).toHaveBeenCalledWith(history);
  });

  it('loads one declarative signal and marks a cold screenshot ready after overlays render', async () => {
    const history = [makeCandle(1, 101), makeCandle(2, 102)];
    const signal = {
      signalId: 'signal-1',
      strategy: 'DoubleTap',
      symbol: 'BTCUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 2,
      figures: { lines: [] },
      indicators: {},
      prices: {
        currentPrice: 102,
        takeProfitPrice: 110,
        stopLossPrice: 98,
        riskRatio: 2,
      },
    };
    searchParamsGetMock.mockImplementation((key: string) => {
      if (key === 'signalId') return 'signal-1';
      if (key === 'autoZoom') return 'true';
      return null;
    });
    useDashboardSignalMock.mockReturnValue({
      queryKey: 'BTCUSDT:signal-1',
      signal,
      status: 'loaded',
    });
    useDataMock.mockReturnValue({
      data: history,
      key: 'bybit_crypto_BTCUSDT_15',
      fulfilled: true,
    });

    render(
      <KlineChart
        id="test-chart"
        filters={filters as never}
        indicators={indicators as never}
        indicatorRenderers={{}}
        live={false}
      />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByTestId('market-chart')
          .getAttribute('data-screenshot-ready'),
      ).toBe('true');
    });
    expect(useDashboardSignalMock).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      signalId: 'signal-1',
    });
    expect(useSignalFiguresMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chart: chartMock,
        lastDataTimestamp: 2,
        enabled: true,
        signal,
        autoZoom: true,
      }),
    );
    expect(useTradeSetupMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chart: chartMock,
        enabled: true,
        signal,
      }),
    );
  });
  it('navigates to trades, compares a second run and reveals orders only as replay advances', async () => {
    const start = 1_790_000_000_000;
    const step = 900_000;
    const history = Array.from({ length: 12 }, (_, index) =>
      makeCandle(start + index * step, 100 + index),
    );
    const entry: OrderLog = {
      index: 0,
      timestamp: history[6].timestamp,
      type: 'OPEN_LONG',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      price: 106,
      qty: 1,
      profit: -1,
      fee: 1,
      amount: 999,
    };
    const orders: OrderLogData = [
      entry,
      {
        ...entry,
        index: 1,
        timestamp: history[7].timestamp,
        price: 99,
        profit: -8,
        type: 'STOP_LOSS_LONG',
      },
    ];
    const comparison: OrderLogData = [
      entry,
      {
        ...entry,
        index: 1,
        timestamp: history[8].timestamp,
        price: 109,
        profit: 2,
        type: 'TAKE_PROFIT_LONG',
      },
    ];
    useBacktestMock.mockImplementation((id) => ({
      backtest:
        id === 'run-a' ? orders : id === 'run-b' ? comparison : emptyOrders,
      loading: false,
    }));
    useDataMock.mockReturnValue({
      data: history,
      key: 'market',
      fulfilled: true,
    });
    render(
      <ChakraProvider value={defaultSystem}>
        <KlineChart
          id="test-chart"
          filters={{ ...filters, backtestId: 'run-a' }}
          indicators={indicators as never}
          indicatorRenderers={{}}
          interactive
          backtestFiles={[{ label: 'Run B', value: 'run-b' }]}
        />
      </ChakraProvider>,
    );

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Compare backtest' }),
      { target: { value: 'run-b' } },
    );
    expect(
      screen.getAllByRole('option', { name: /Exit changed/ }),
    ).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter trades' }), {
      target: { value: 'losing' },
    });
    expect(
      screen.getAllByRole('option', { name: /Exit changed/ }),
    ).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox', { name: 'Select trade' }), {
      target: { value: '0' },
    });
    expect(screen.getByText(/Net P&L -9.00/)).toBeTruthy();
    expect(screen.getByText(/Stop loss · 1 @ 99/)).toBeTruthy();
    expect(chartMock.setBarSpace).toHaveBeenCalled();
    expect(chartMock.scrollToDataIndex).toHaveBeenCalledWith(11);

    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    const replayInput = await screen.findByLabelText(
      'Replay start date and time',
    );
    fireEvent.change(replayInput, { target: { value: '2030-01-01T00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start replay' }));
    expect(screen.queryByRole('button', { name: 'End replay' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('loaded history');
    fireEvent.change(replayInput, { target: { value: '' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Start replay' }),
    );
    expect(displayed).toEqual(history.slice(0, 2));
    expect(screen.queryByRole('option', { name: /Exit changed/ })).toBeNull();
    expect(useDataMock).toHaveBeenLastCalledWith(expect.anything(), false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter trades' }), {
      target: { value: 'all' },
    });
    for (let i = 0; i < 5; i++)
      fireEvent.click(screen.getByRole('button', { name: 'Next candle' }));
    expect(displayed.at(-1)).toEqual(history[6]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Select trade' }), {
      target: { value: '0' },
    });
    expect(screen.getByText(/Open position/)).toBeTruthy();
    expect(screen.queryByText(/Stop loss/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next candle' }));
    expect(screen.getByText(/Stop loss · 1 @ 99/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous candle' }));
    expect(displayed).toHaveLength(7);
    expect(screen.queryByText(/Stop loss/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'End replay' }));
    expect(displayed).toEqual(history);
    expect(history).toHaveLength(12);
  });

  it('restores saved drawings after remounting and removes only the selected market drawing', () => {
    const history = [makeCandle(1, 101), makeCandle(2, 102)];
    useDataMock.mockReturnValue({
      data: history,
      key: 'market',
      fulfilled: true,
    });
    const view = (
      <ChakraProvider value={defaultSystem}>
        <KlineChart
          id="test-chart"
          filters={filters}
          indicators={indicators as never}
          indicatorRenderers={{}}
          interactive
        />
      </ChakraProvider>
    );
    const { unmount } = render(view);
    const measure = screen.getByRole('button', { name: 'Measure' });
    fireEvent.click(measure);
    chartMock.convertFromPixel.mockReturnValue([{ timestamp: 1, value: 101 }]);
    fireEvent.click(canvasPane);
    expect(chartMock.createOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'manual-chart-drawing-preview' }),
    );
    fireEvent.keyDown(measure, { key: 'Escape' });
    expect(measure.getAttribute('aria-pressed')).toBe('false');
    expect(chartMock.removeOverlay).toHaveBeenCalledWith({
      id: 'manual-chart-drawing-preview',
    });
    expect(localStorage.getItem('tradejs:chart-drawings:market')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Price level' }));
    const points = [{ timestamp: 2, value: 102 }];
    chartMock.convertFromPixel.mockReturnValue(points);
    fireEvent.click(canvasPane);
    const drawing = chartMock.createOverlay.mock.calls.at(-1)?.[0];
    expect(localStorage.getItem('tradejs:chart-drawings:market')).toContain(
      '"value":102',
    );
    unmount();

    chartMock.createOverlay.mockClear();
    render(view);
    expect(chartMock.createOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ points, lock: true }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove last drawing' }),
    );
    expect(localStorage.getItem('tradejs:chart-drawings:market')).toBe('[]');
    expect(chartMock.removeOverlay).toHaveBeenCalledWith({ id: drawing?.id });
  });
});
