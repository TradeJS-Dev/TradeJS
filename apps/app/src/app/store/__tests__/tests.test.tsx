import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { resetTestsStoreForTests, useTestList } from '../tests';

const getBacktestFilesMock = jest.fn();
const idbGetMock = jest.fn();
const idbSetMock = jest.fn();

jest.mock('@actions/backtest', () => ({
  getBacktestFiles: (...args: unknown[]) => getBacktestFilesMock(...args),
  getBacktest: jest.fn(),
  getOrderLog: jest.fn(),
}));

jest.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => idbGetMock(...args),
  set: (...args: unknown[]) => idbSetMock(...args),
  del: jest.fn(),
}));

jest.mock('@tradejs/core/async', () => ({
  delay: async () => undefined,
}));

const Probe = ({
  enabled = true,
  symbol,
}: {
  enabled?: boolean;
  symbol?: string;
}) => {
  const { tests } = useTestList({ enabled, symbol });

  return <div data-testid="probe" data-length={String(tests.length)} />;
};

describe('store/useTestList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTestsStoreForTests();
    idbGetMock.mockResolvedValue(null);
    idbSetMock.mockResolvedValue(undefined);
  });

  it('does not load backtest files until enabled', async () => {
    getBacktestFilesMock.mockResolvedValue([
      { value: 'BTCUSDT__1', label: 'BTCUSDT_1' },
    ]);

    const { rerender, getByTestId } = render(<Probe enabled={false} />);

    expect(getBacktestFilesMock).not.toHaveBeenCalled();
    expect(getByTestId('probe').getAttribute('data-length')).toBe('0');

    rerender(<Probe enabled />);

    await waitFor(() => {
      expect(getBacktestFilesMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('probe').getAttribute('data-length')).toBe('1');
    });
  });

  it('does not refetch backtest files on remount while ttl is still fresh', async () => {
    getBacktestFilesMock.mockResolvedValue([
      {
        value: 'BTCUSDT__1',
        label: 'BTCUSDT_1',
        data: { strategyName: 'TrendLine', netProfit: 10 },
      },
    ]);

    const first = render(<Probe enabled />);

    await waitFor(() => {
      expect(getBacktestFilesMock).toHaveBeenCalledTimes(1);
      expect(first.getByTestId('probe').getAttribute('data-length')).toBe('1');
    });

    first.unmount();

    const second = render(<Probe enabled />);

    await waitFor(() => {
      expect(second.getByTestId('probe').getAttribute('data-length')).toBe('1');
    });

    expect(getBacktestFilesMock).toHaveBeenCalledTimes(1);
  });
});
