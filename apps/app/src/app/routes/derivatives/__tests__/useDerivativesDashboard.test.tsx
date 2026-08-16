import { act, renderHook, waitFor } from '@testing-library/react';
import { useDerivativesDashboard } from '../useDerivativesDashboard';

const mockLoadDashboard = jest.fn();
const mockToastError = jest.fn();

jest.mock('../derivativesDashboardLoader', () => ({
  loadDerivativesDashboardData: (...args: unknown[]) =>
    mockLoadDashboard(...args),
}));

jest.mock('#ui', () => ({
  toaster: { error: (...args: unknown[]) => mockToastError(...args) },
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const data = (endTimestamp: number) => ({
  summary: { hours: 24, items: [] },
  detailsBySymbol: {},
  pricesBySymbol: {},
  chartWindow: { startTimestamp: 0, endTimestamp },
});

describe('useDerivativesDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ignores a stale response after filters change', async () => {
    const first = deferred<ReturnType<typeof data>>();
    const second = deferred<ReturnType<typeof data>>();
    mockLoadDashboard
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useDerivativesDashboard());
    await waitFor(() => expect(mockLoadDashboard).toHaveBeenCalledTimes(1));

    act(() => result.current.setHours('168'));
    await waitFor(() => expect(mockLoadDashboard).toHaveBeenCalledTimes(2));

    await act(async () => second.resolve(data(2)));
    await waitFor(() =>
      expect(result.current.chartWindow.endTimestamp).toBe(2),
    );

    await act(async () => first.resolve(data(1)));
    expect(result.current.chartWindow.endTimestamp).toBe(2);
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
