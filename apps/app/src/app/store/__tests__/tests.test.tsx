import React from 'react';
import { render, waitFor } from '@testing-library/react';
import {
  resetTestsStoreForTests,
  setBacktestCacheSession,
  useBacktest,
  useTest,
  useTestList,
  useBacktestMutations,
} from '../tests';

const getBacktestFilesMock = jest.fn();
const getBacktestMock = jest.fn();
const getOrderLogMock = jest.fn();
const idbGetMock = jest.fn();
const idbSetMock = jest.fn();

jest.mock('#actions/backtest', () => ({
  getBacktestFiles: (...args: unknown[]) => getBacktestFilesMock(...args),
  getBacktest: (...args: unknown[]) => getBacktestMock(...args),
  getOrderLog: (...args: unknown[]) => getOrderLogMock(...args),
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

  it('refetches backtest files when indexeddb cache is stale', async () => {
    idbGetMock.mockResolvedValue({
      savedAt: Date.now() - 6 * 60 * 1000,
      items: [{ value: 'OLD__1', label: 'OLD_1' }],
    });
    getBacktestFilesMock.mockResolvedValue([
      {
        value: 'ETHUSDT__2',
        label: 'ETHUSDT_2',
        data: { strategyName: 'TrendLine', netProfit: 12 },
      },
    ]);

    const { getByTestId } = render(<Probe enabled />);

    await waitFor(() => {
      expect(getBacktestFilesMock).toHaveBeenCalledTimes(1);
      expect(getByTestId('probe').getAttribute('data-length')).toBe('1');
    });
    expect(idbSetMock).toHaveBeenCalledWith(
      JSON.stringify(['backtest-cache-v3', null, 'files', '', '']),
      {
        savedAt: expect.any(Number),
        items: [
          {
            value: 'ETHUSDT__2',
            label: 'ETHUSDT_2',
            data: { strategyName: 'TrendLine', netProfit: 12 },
          },
        ],
      },
    );
  });

  it('exposes load errors when backtest files fetch fails', async () => {
    getBacktestFilesMock.mockRejectedValue(new Error('files failed'));

    const ErrorProbe = () => {
      const { error, fulFilled } = useTestList({ enabled: true });

      return (
        <div
          data-testid="error-probe"
          data-error={error instanceof Error ? error.message : ''}
          data-fulfilled={String(fulFilled)}
        />
      );
    };

    const { getByTestId } = render(<ErrorProbe />);

    await waitFor(() => {
      expect(getByTestId('error-probe').getAttribute('data-error')).toBe(
        'files failed',
      );
    });
    expect(getByTestId('error-probe').getAttribute('data-fulfilled')).toBe(
      'false',
    );
  });
});

describe('store/useBacktest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTestsStoreForTests();
    idbGetMock.mockResolvedValue(null);
    idbSetMock.mockResolvedValue(undefined);
  });

  it('reports a missing order log separately from an empty log', async () => {
    getBacktestFilesMock.mockResolvedValue([
      {
        value: 'BTCUSDT__1',
        label: 'BTCUSDT_1',
        data: { strategyName: 'TrendLine', netProfit: 10 },
      },
    ]);
    getOrderLogMock.mockRejectedValue(
      new Error('{"error":"Backtest order log not found"}'),
    );

    const BacktestProbe = () => {
      const { backtest, loading, unavailable } = useBacktest('BTCUSDT__1');

      return (
        <div
          data-testid="backtest-probe"
          data-length={String(backtest.length)}
          data-loading={String(loading)}
          data-unavailable={String(unavailable)}
        />
      );
    };

    const { getByTestId } = render(<BacktestProbe />);

    await waitFor(() => {
      expect(getOrderLogMock).toHaveBeenCalledWith('BTCUSDT__1', 'TrendLine');
      expect(getByTestId('backtest-probe').getAttribute('data-loading')).toBe(
        'false',
      );
    });
    expect(getByTestId('backtest-probe').getAttribute('data-length')).toBe('0');
    expect(getByTestId('backtest-probe').getAttribute('data-unavailable')).toBe(
      'true',
    );
  });
});

describe('store/useTest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTestsStoreForTests();
    idbGetMock.mockResolvedValue(null);
    idbSetMock.mockResolvedValue(undefined);
  });

  it('removes a result from the list when its data returns 404', async () => {
    getBacktestFilesMock.mockResolvedValue([
      {
        value: 'BTCUSDT__1',
        label: 'BTCUSDT_1',
        data: { strategyName: 'TrendLine', netProfit: 10 },
      },
      {
        value: 'ETHUSDT__2',
        label: 'ETHUSDT_2',
        data: { strategyName: 'TrendLine', netProfit: 5 },
      },
    ]);
    getBacktestMock.mockRejectedValue(
      new Error('{"error":"Backtest order log not found"}'),
    );

    const TestProbe = () => {
      const test = useTest('BTCUSDT__1');
      const { tests } = useTestList();

      return (
        <div
          data-testid="test-probe"
          data-tests={tests.map((item) => item.value).join(',')}
          data-state={
            test === null ? 'unavailable' : test ? 'ready' : 'loading'
          }
        />
      );
    };

    const { getByTestId } = render(<TestProbe />);

    await waitFor(() => {
      expect(getBacktestMock).toHaveBeenCalledWith('BTCUSDT__1', 'TrendLine');
      expect(getByTestId('test-probe').getAttribute('data-state')).toBe(
        'unavailable',
      );
      expect(getByTestId('test-probe').getAttribute('data-tests')).toBe(
        'ETHUSDT__2',
      );
    });
    expect(getBacktestMock).toHaveBeenCalledTimes(1);
  });
});

it('separates users and ignores a late file-list response from the previous session', async () => {
  await setBacktestCacheSession('alice');
  idbGetMock.mockResolvedValue(null);
  let finish!: (value: unknown) => void;
  getBacktestFilesMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = render(<Probe />);
  await waitFor(() => expect(finish).toBeDefined());
  first.unmount();
  await setBacktestCacheSession('bob');
  getBacktestFilesMock.mockResolvedValue([
    { value: 'BOB__1', label: 'Bob', data: { strategyName: 'TrendLine' } },
  ]);
  const second = render(<Probe />);
  await waitFor(() =>
    expect(second.getByTestId('probe').getAttribute('data-length')).toBe('1'),
  );
  finish([{ value: 'ALICE__1', label: 'Alice' }]);
  await Promise.resolve();
  expect(second.getByTestId('probe').getAttribute('data-length')).toBe('1');
  expect(
    idbSetMock.mock.calls.filter(([key]) => String(key).includes('alice')),
  ).toHaveLength(0);
  expect(
    idbSetMock.mock.calls.some(([key]) => String(key).includes('bob')),
  ).toBe(true);
  second.unmount();
  await setBacktestCacheSession(null);
});

it('does not copy a previous user file cache when removal completes after a session switch', async () => {
  await setBacktestCacheSession('alice');
  let finish!: (value: unknown) => void;
  idbGetMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let remove!: (name: string) => Promise<void>;
  const MutationProbe = () => {
    const { removeBacktestTest } = useBacktestMutations();
    React.useEffect(() => {
      remove = removeBacktestTest;
    }, [removeBacktestTest]);
    return null;
  };
  const view = render(<MutationProbe />);
  const pending = remove('REMOVE__1');
  await setBacktestCacheSession('bob');
  const writes = idbSetMock.mock.calls.length;
  finish({
    savedAt: Date.now(),
    items: [{ value: 'ALICE__1', label: 'Alice' }],
  });
  await pending;
  expect(idbSetMock.mock.calls).toHaveLength(writes);
  view.unmount();
  await setBacktestCacheSession(null);
});

it('keeps session changes available when browser storage is disabled', async () => {
  const read = jest
    .spyOn(Storage.prototype, 'getItem')
    .mockImplementation(() => {
      throw new Error('storage disabled');
    });
  const write = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('storage disabled');
    });
  try {
    await expect(
      setBacktestCacheSession('private-user'),
    ).resolves.toBeUndefined();
  } finally {
    read.mockRestore();
    write.mockRestore();
    await setBacktestCacheSession(null);
  }
});
