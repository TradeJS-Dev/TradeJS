import React from 'react';
import { render } from '@testing-library/react';

const setFiltersMock = jest.fn();
const useIndicatorsMock = jest.fn();
const klineChartMock = jest.fn(() => null);

jest.mock('@store', () => ({
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
  useIndicators: () => useIndicatorsMock(),
}));

jest.mock('../../KlineChart', () => ({
  KlineChart: (props: unknown) => {
    klineChartMock(props);
    return null;
  },
}));

describe('Dashboard/MainChart', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useIndicatorsMock.mockReturnValue({
      indicatorsByKey: {
        vol: {
          id: 'vol',
          label: 'Vol',
          enabled: true,
        },
      },
      indicatorRenderers: {},
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does not schedule dashboard auto-refresh in screenshot mode', async () => {
    const { MainChart } = require('..');

    render(<MainChart screenshotMode />);

    expect(klineChartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'main-chart',
      }),
    );

    jest.advanceTimersByTime(11_000);

    expect(setFiltersMock).not.toHaveBeenCalled();
  });

  it('keeps dashboard auto-refresh in normal mode', async () => {
    const { MainChart } = require('..');

    render(<MainChart />);

    jest.advanceTimersByTime(11_000);

    expect(setFiltersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        end: expect.any(Number),
      }),
    );
  });
});
