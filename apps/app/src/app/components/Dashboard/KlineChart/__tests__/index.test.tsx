import React from 'react';
import { render, screen } from '@testing-library/react';
import { KlineChart } from '..';

const useDataMock = jest.fn();
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
  useSetup: jest.fn(),
  useSignal: jest.fn(),
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
    getBars({ callback });
    expect(callback).toHaveBeenCalledWith(history);
  });
});
