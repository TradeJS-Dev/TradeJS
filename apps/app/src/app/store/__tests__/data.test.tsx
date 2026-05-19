import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useData } from '../data';

const klineMock = jest.fn();
const idbGetMock = jest.fn();
const idbSetMock = jest.fn();
const useSearchParamsMock = jest.fn();

jest.mock('#actions/kline', () => ({
  kline: (...args: unknown[]) => klineMock(...args),
}));

jest.mock('idb-keyval', () => ({
  get: (...args: unknown[]) => idbGetMock(...args),
  set: (...args: unknown[]) => idbSetMock(...args),
}));

jest.mock('next/navigation', () => ({
  useSearchParams: () => useSearchParamsMock(),
}));

const makeCandle = (timestamp: number, close: number) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: close * 10,
});

const makeData = () => [
  makeCandle(1_710_000_000_000, 100),
  makeCandle(1_710_000_900_000, 101),
  makeCandle(1_710_001_800_000, 102),
];

const makeFilters = (overrides: Record<string, unknown> = {}) => ({
  provider: 'bybit',
  symbol: 'BTCUSDT_TEST',
  interval: '15',
  start: 1_710_000_000_000,
  end: 1_710_001_800_000,
  backtestId: null,
  backtestStrategy: null,
  ...overrides,
});

const Probe = ({
  filters,
  testId = 'probe',
}: {
  filters: ReturnType<typeof makeFilters>;
  testId?: string;
}) => {
  const { data, fulfilled } = useData(filters);

  return (
    <div
      data-testid={testId}
      data-fulfilled={fulfilled ? '1' : '0'}
      data-length={String(data.length)}
      data-first-ts={data[0]?.timestamp ? String(data[0].timestamp) : ''}
    />
  );
};

describe('store/useData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSearchParamsMock.mockReturnValue(new URLSearchParams());
    idbGetMock.mockResolvedValue(null);
    idbSetMock.mockResolvedValue(undefined);
  });

  it('does not refetch in a loop after storing freshly loaded data', async () => {
    klineMock.mockResolvedValue(makeData());
    const filters = makeFilters({ symbol: 'BTCUSDT_LOOP_TEST' });

    const { rerender, getByTestId } = render(<Probe filters={filters} />);

    await waitFor(() => {
      expect(klineMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('probe').getAttribute('data-fulfilled')).toBe('1');
      expect(getByTestId('probe').getAttribute('data-length')).toBe('3');
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(klineMock).toHaveBeenCalledTimes(1);

    rerender(<Probe filters={{ ...filters, end: 3 }} />);

    await waitFor(() => {
      expect(klineMock).toHaveBeenCalledTimes(2);
    });
  });

  it('deduplicates concurrent consumers for the same request key', async () => {
    const requestPromise = Promise.resolve(makeData());
    klineMock.mockReturnValue(requestPromise);
    const filters = makeFilters({ symbol: 'BTCUSDT_DEDUPE_TEST' });

    const { getByTestId } = render(
      <>
        <Probe filters={filters} testId="probe-a" />
        <Probe filters={filters} testId="probe-b" />
      </>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(klineMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(getByTestId('probe-a').getAttribute('data-length')).toBe('3');
      expect(getByTestId('probe-b').getAttribute('data-length')).toBe('3');
    });
  });

  it('filters cached idb data to the requested start/end window', async () => {
    const cachedData = makeData();
    idbGetMock.mockResolvedValue(cachedData);
    klineMock.mockResolvedValue([
      makeCandle(1_710_001_800_000, 102),
      makeCandle(1_710_002_700_000, 103),
    ]);

    const filters = makeFilters({
      symbol: 'BTCUSDT_WINDOW_TEST',
      start: 1_710_000_900_000,
      end: 1_710_001_800_000,
    });

    const { getByTestId } = render(<Probe filters={filters} />);

    await waitFor(() => {
      expect(getByTestId('probe').getAttribute('data-fulfilled')).toBe('1');
      expect(getByTestId('probe').getAttribute('data-length')).toBe('2');
      expect(getByTestId('probe').getAttribute('data-first-ts')).toBe(
        '1710000900000',
      );
    });
  });

  it('resets fulfilled when the requested start window changes', async () => {
    klineMock
      .mockResolvedValueOnce(makeData())
      .mockResolvedValueOnce([
        makeCandle(1_710_001_800_000, 102),
        makeCandle(1_710_002_700_000, 103),
      ]);
    const filters = makeFilters({ symbol: 'BTCUSDT_FULFILLED_TEST', end: 3 });

    const { getByTestId, rerender } = render(<Probe filters={filters} />);

    await waitFor(() => {
      expect(getByTestId('probe').getAttribute('data-fulfilled')).toBe('1');
    });

    rerender(
      <Probe
        filters={{
          ...filters,
          start: 1_710_001_800_000,
          end: 1_710_002_700_000,
        }}
      />,
    );

    expect(getByTestId('probe').getAttribute('data-fulfilled')).toBe('0');

    await waitFor(() => {
      expect(klineMock).toHaveBeenCalledTimes(2);
      expect(getByTestId('probe').getAttribute('data-fulfilled')).toBe('1');
      expect(getByTestId('probe').getAttribute('data-first-ts')).toBe(
        '1710001800000',
      );
    });
  });
});
