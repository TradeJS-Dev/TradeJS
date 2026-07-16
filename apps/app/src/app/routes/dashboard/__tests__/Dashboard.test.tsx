import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const setFiltersMock = jest.fn();
const useSearchParamsMock = jest.fn();
const mainChartMock = jest.fn(() => null);

jest.mock('next/navigation', () => ({
  useSearchParams: () => useSearchParamsMock(),
}));

jest.mock('@chakra-ui/react', () => ({
  Box: ({ children, ...props }: any) => (
    <div data-testid={props['data-testid']}>{children}</div>
  ),
  Flex: ({ children, ...props }: any) => (
    <div data-testid={props['data-testid']}>{children}</div>
  ),
  Button: ({ children }: any) => <button>{children}</button>,
  ClientOnly: ({ children }: any) => <>{children}</>,
}));

jest.mock('#store', () => ({
  useFilters: () => ({
    filters: {
      provider: 'bybit',
      symbol: 'BTCUSDT',
      interval: '15',
      start: 1,
      end: 2,
      backtestId: null,
      backtestStrategy: null,
    },
    setFilters: setFiltersMock,
  }),
  useTickers: () => ({
    tickers: ['BTCUSDT'],
  }),
  useTestList: () => ({
    tests: [],
  }),
}));

jest.mock('#shared/Filters', () => ({
  Filters: {
    Root: ({ children }: any) => (
      <div data-testid="filters-root">{children}</div>
    ),
    SelectProvider: () => <div>provider-filter</div>,
    SelectSymbol: () => <div>symbol-filter</div>,
    FavoriteIndicator: () => <div>favorite-indicator</div>,
    SelectInterval: () => <div>interval-filter</div>,
    SelectIndicator: () => <div>indicator-filter</div>,
    SelectBacktest: () => <div>backtest-filter</div>,
  },
}));

jest.mock('#app/components/Dashboard/MainChart', () => ({
  MainChart: (props: unknown) => {
    mainChartMock(props);
    return <div data-testid="main-chart" />;
  },
}));

describe('Dashboard route screenshot mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(
      null,
      '',
      '/routes/dashboard/bybit/crypto/BTCUSDT/15',
    );
  });

  it('hides filters and enables screenshot mode for the chart', async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('signalId=test&screenshot=1'),
    );

    const Dashboard = require('../Dashboard').default;

    render(<Dashboard />);

    await waitFor(() => {
      expect(setFiltersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'bybit',
          symbol: 'BTCUSDT',
          interval: '15',
        }),
      );
    });

    expect(screen.queryByTestId('filters-root')).toBeNull();
    expect(mainChartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshotMode: true,
      }),
    );
  });

  it('keeps filters visible outside screenshot mode', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('signalId=test'));

    const Dashboard = require('../Dashboard').default;

    render(<Dashboard />);

    await waitFor(() => {
      expect(setFiltersMock).toHaveBeenCalled();
    });

    expect(screen.getByTestId('filters-root')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Create backtest' })
        .getAttribute('href'),
    ).toBe('/routes/backtest');
    expect(mainChartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshotMode: false,
      }),
    );
  });

  it('parses the TradFi path segment', async () => {
    window.history.replaceState(
      null,
      '',
      '/routes/dashboard/bybit/tradfi/AAPLUSDT/15',
    );
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    const Dashboard = require('../Dashboard').default;

    render(<Dashboard />);

    await waitFor(() => {
      expect(setFiltersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'bybit',
          universe: 'tradfi',
          symbol: 'AAPLUSDT',
          interval: '15',
        }),
      );
    });
  });
});
