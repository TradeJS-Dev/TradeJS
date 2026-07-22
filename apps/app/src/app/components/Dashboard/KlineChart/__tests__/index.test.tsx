import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { KlineChart } from '..';

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
  getDataList: jest.fn(() => []),
  getVisibleRange: jest.fn(() => ({ realTo: 0 })),
  scrollToDataIndex: jest.fn(),
};

jest.mock('klinecharts', () => ({
  init: () => chartMock,
  dispose: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchParamsGetMock }),
}));

jest.mock('#store', () => ({
  useData: (...args: unknown[]) => useDataMock(...args),
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

jest.mock('#ui', () => ({
  OverlaySpinner: () => <div data-testid="spinner" />,
}));

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
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
  beforeEach(() => {
    jest.clearAllMocks();
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
    setDataLoaderMock.mockImplementation(({ getBars }) => {
      getBars({ callback: jest.fn() });
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
});
