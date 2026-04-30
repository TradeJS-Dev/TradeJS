import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { resetTickersStoreForTests, useTickers } from '../tickers';

const scanMock = jest.fn();
const idbGetMock = jest.fn();
const idbSetMock = jest.fn();

jest.mock('@actions/scanner', () => ({
  scan: (...args: unknown[]) => scanMock(...args),
}));

jest.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => idbGetMock(...args),
  set: (...args: unknown[]) => idbSetMock(...args),
}));

const Probe = ({
  provider = 'bybit',
  enabled = true,
}: {
  provider?: string;
  enabled?: boolean;
}) => {
  const { tickers } = useTickers(provider, { enabled });

  return <div data-testid="probe" data-length={String(tickers.length)} />;
};

describe('store/useTickers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTickersStoreForTests();
    idbGetMock.mockResolvedValue(null);
    idbSetMock.mockResolvedValue(undefined);
  });

  it('does not load tickers until enabled', async () => {
    scanMock.mockResolvedValue([{ value: 'BTCUSDT', label: 'BTCUSDT' }]);

    const { rerender, getByTestId } = render(
      <Probe provider="bybit" enabled={false} />,
    );

    expect(scanMock).not.toHaveBeenCalled();
    expect(getByTestId('probe').getAttribute('data-length')).toBe('0');

    rerender(<Probe provider="bybit" enabled />);

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('probe').getAttribute('data-length')).toBe('1');
    });
  });

  it('serves fresh tickers from idb cache without scanner request', async () => {
    idbGetMock.mockResolvedValue({
      savedAt: Date.now(),
      items: [{ value: 'ETHUSDT', label: 'ETHUSDT' }],
    });

    const { getByTestId } = render(<Probe provider="binance" enabled />);

    await waitFor(() => {
      expect(scanMock).not.toHaveBeenCalled();
      expect(getByTestId('probe').getAttribute('data-length')).toBe('1');
    });
  });
});
