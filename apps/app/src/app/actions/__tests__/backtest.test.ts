import { API } from '@utils/api';
import {
  deleteBacktest,
  getBacktest,
  getBacktestFiles,
  getOrderLog,
} from '../backtest';

jest.mock('@utils/api', () => ({
  API: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedGet = API.get as jest.MockedFunction<typeof API.get>;
const mockedDelete = API.delete as jest.MockedFunction<typeof API.delete>;

describe('backtest actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getBacktestFiles returns empty list when payload has no items', async () => {
    mockedGet.mockResolvedValue({} as any);

    await expect(getBacktestFiles()).resolves.toEqual([]);
    expect(mockedGet).toHaveBeenCalledWith('/api/backtest/files');
  });

  it('getBacktestFiles returns items from API payload', async () => {
    mockedGet.mockResolvedValue({
      items: [{ label: 't1', value: 't1' }],
    } as any);

    await expect(getBacktestFiles()).resolves.toEqual([
      { label: 't1', value: 't1' },
    ]);
  });

  it('getOrderLog returns null when args are missing', async () => {
    await expect(getOrderLog(undefined, 'TrendLine')).resolves.toBeNull();
    await expect(getOrderLog('t1', undefined)).resolves.toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('getOrderLog uses expected API url', async () => {
    mockedGet.mockResolvedValue({ orderLog: [{ amount: 100 }] } as any);

    await expect(getOrderLog('t1', 'TrendLine')).resolves.toEqual([
      { amount: 100 },
    ]);
    expect(mockedGet).toHaveBeenCalledWith(
      '/api/backtest/order-log/TrendLine/t1',
    );
  });

  it('getBacktest returns null when args are missing', async () => {
    await expect(getBacktest(undefined, 'TrendLine')).resolves.toBeNull();
    await expect(getBacktest('t1', undefined)).resolves.toBeNull();
  });

  it('getBacktest uses expected API url', async () => {
    mockedGet.mockResolvedValue({ result: { test: { name: 't1' } } } as any);

    await expect(getBacktest('t1', 'TrendLine')).resolves.toEqual({
      test: { name: 't1' },
    });
    expect(mockedGet).toHaveBeenCalledWith('/api/backtest/result/TrendLine/t1');
  });

  it('deleteBacktest returns false when args are missing', async () => {
    await expect(deleteBacktest(undefined, 'TrendLine')).resolves.toBe(false);
    await expect(deleteBacktest('t1', undefined)).resolves.toBe(false);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('deleteBacktest uses encoded API url and returns true only for deleted=true', async () => {
    mockedDelete.mockResolvedValueOnce({ deleted: true } as any);
    mockedDelete.mockResolvedValueOnce({ deleted: false } as any);

    await expect(deleteBacktest('t 1', 'Trend/Line')).resolves.toBe(true);
    await expect(deleteBacktest('t 2', 'Trend/Line')).resolves.toBe(false);

    expect(mockedDelete).toHaveBeenNthCalledWith(
      1,
      '/api/backtest/test/Trend%2FLine/t%201',
    );
    expect(mockedDelete).toHaveBeenNthCalledWith(
      2,
      '/api/backtest/test/Trend%2FLine/t%202',
    );
  });
});
