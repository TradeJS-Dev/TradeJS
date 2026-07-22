import { renderHook, waitFor } from '@testing-library/react';
import { getSignal } from '#actions/signal';
import { useDashboardSignal } from '../useDashboardSignal';

jest.mock('#actions/signal', () => ({
  getSignal: jest.fn(),
}));

const getSignalMock = getSignal as jest.MockedFunction<typeof getSignal>;

const makeSignal = (symbol: string, signalId: string) =>
  ({
    signalId,
    strategy: 'DoubleTap',
    symbol,
    interval: '15',
    direction: 'LONG',
    timestamp: 1,
    figures: {},
    indicators: {},
    prices: {
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    },
  }) as Awaited<ReturnType<typeof getSignal>>;

describe('useDashboardSignal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads a signal once from declarative route state and hides stale data', async () => {
    const btcSignal = makeSignal('BTCUSDT', 'signal-1');
    const ethSignal = makeSignal('ETHUSDT', 'signal-1');
    getSignalMock
      .mockResolvedValueOnce(btcSignal)
      .mockResolvedValueOnce(ethSignal);

    const { result, rerender } = renderHook(
      ({ symbol, signalId }) => useDashboardSignal({ symbol, signalId }),
      {
        initialProps: { symbol: 'BTCUSDT', signalId: 'signal-1' },
      },
    );

    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.signal).toBe(btcSignal);
    expect(getSignalMock).toHaveBeenCalledTimes(1);
    expect(getSignalMock).toHaveBeenCalledWith('BTCUSDT', 'signal-1');

    rerender({ symbol: 'BTCUSDT', signalId: 'signal-1' });
    expect(getSignalMock).toHaveBeenCalledTimes(1);

    rerender({ symbol: 'ETHUSDT', signalId: 'signal-1' });
    expect(result.current.status).toBe('loading');
    expect(result.current.signal).toBeNull();

    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.signal).toBe(ethSignal);
    expect(getSignalMock).toHaveBeenLastCalledWith('ETHUSDT', 'signal-1');
  });

  it('reports a missing signal without exposing a previous payload', async () => {
    getSignalMock.mockResolvedValue(null);

    const { result } = renderHook(() =>
      useDashboardSignal({ symbol: 'BTCUSDT', signalId: 'missing' }),
    );

    await waitFor(() => expect(result.current.status).toBe('missing'));
    expect(result.current.signal).toBeNull();
  });
});
