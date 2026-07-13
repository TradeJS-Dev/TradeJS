import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { resetTickersStoreForTests, useTickers } from '../tickers';

const scanMock = jest.fn();
const idbGetMock = jest.fn();
const idbSetMock = jest.fn();

jest.mock('#actions/scanner', () => ({
  scan: (...args: unknown[]) => scanMock(...args),
}));

jest.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => idbGetMock(...args),
  set: (...args: unknown[]) => idbSetMock(...args),
}));

const Probe = ({
  provider = 'bybit',
  universe = 'crypto',
  enabled = true,
  onReady,
}: {
  provider?: string;
  universe?: 'crypto' | 'tradfi';
  enabled?: boolean;
  onReady?: (api: { ensureLoaded: () => Promise<unknown> }) => void;
}) => {
  const { tickers, ensureLoaded } = useTickers(provider, universe, { enabled });

  React.useEffect(() => {
    onReady?.({ ensureLoaded });
  }, [ensureLoaded, onReady]);

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

  it('refetches tickers when indexeddb cache is stale', async () => {
    idbGetMock.mockResolvedValue({
      savedAt: Date.now() - 11 * 60 * 1000,
      items: [{ value: 'OLD', label: 'OLD' }],
    });
    scanMock.mockResolvedValue([{ value: 'SOLUSDT', label: 'SOLUSDT' }]);

    const { getByTestId } = render(<Probe provider="bybit" enabled />);

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('probe').getAttribute('data-length')).toBe('1');
    });
    expect(idbSetMock).toHaveBeenCalledWith('tickers:bybit', {
      savedAt: expect.any(Number),
      items: [{ value: 'SOLUSDT', label: 'SOLUSDT' }],
    });
  });

  it('uses stale cached tickers when scanner refresh fails', async () => {
    const staleItems = [{ value: 'BTCUSDT', label: 'BTCUSDT' }];
    idbGetMock.mockResolvedValue({
      savedAt: Date.now() - 11 * 60 * 1000,
      items: staleItems,
    });
    scanMock.mockRejectedValue(new Error('provider unavailable'));

    const { getByTestId } = render(<Probe provider="bybit" enabled />);

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('probe').getAttribute('data-length')).toBe('1');
    });
    expect(idbSetMock).not.toHaveBeenCalled();
  });

  it('handles an initial background scanner failure', async () => {
    scanMock.mockRejectedValue(new Error('provider unavailable'));

    render(<Probe provider="bybit" enabled />);

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledTimes(1);
    });
  });

  it('clears in-flight state after scanner failure so ensureLoaded can retry', async () => {
    let api!: { ensureLoaded: () => Promise<unknown> };
    scanMock
      .mockRejectedValueOnce(new Error('scanner failed'))
      .mockResolvedValueOnce([{ value: 'BTCUSDT', label: 'BTCUSDT' }]);

    render(
      <Probe
        provider="bybit"
        enabled={false}
        onReady={(value) => {
          api = value;
        }}
      />,
    );

    await act(async () => {
      await expect(api.ensureLoaded()).rejects.toThrow('scanner failed');
    });
    await act(async () => {
      await expect(api.ensureLoaded()).resolves.toEqual([
        { value: 'BTCUSDT', label: 'BTCUSDT' },
      ]);
    });
    expect(scanMock).toHaveBeenCalledTimes(2);
  });

  it('keeps Crypto and TradFi scanner caches isolated', async () => {
    scanMock.mockImplementation(async (_provider: string, universe: string) =>
      universe === 'tradfi'
        ? [{ value: 'AAPLUSDT', label: 'AAPLUSDT' }]
        : [{ value: 'BTCUSDT', label: 'BTCUSDT' }],
    );

    render(
      <>
        <Probe provider="bybit" universe="crypto" />
        <Probe provider="bybit" universe="tradfi" />
      </>,
    );

    await waitFor(() => {
      expect(scanMock).toHaveBeenCalledWith('bybit', 'crypto');
      expect(scanMock).toHaveBeenCalledWith('bybit', 'tradfi');
      expect(scanMock).toHaveBeenCalledTimes(2);
    });
    expect(idbGetMock).toHaveBeenCalledWith('tickers:bybit');
    expect(idbGetMock).toHaveBeenCalledWith('tickers:bybit:tradfi');
    expect(idbSetMock).toHaveBeenCalledWith(
      'tickers:bybit:tradfi',
      expect.objectContaining({
        items: [{ value: 'AAPLUSDT', label: 'AAPLUSDT' }],
      }),
    );
  });
});
