jest.mock('@tradejs/infra/redis', () => ({
  delKey: jest.fn(),
  getData: jest.fn(),
  getKeys: jest.fn(),
  redisKeys: {
    backtestJob: (userName: string, jobId: string) =>
      `users:${userName}:backtests:jobs:${jobId}`,
    backtestJobs: (userName: string) => `users:${userName}:backtests:jobs:`,
  },
  setData: jest.fn(),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
    warn: jest.fn(),
  },
}));

import {
  buildBacktestCommandArgs,
  isBacktestJobRecord,
  listBacktestJobs,
  normalizeBacktestJobRequest,
  parseBacktestProgressLine,
} from '../backtestJobs';
import { getData, getKeys, setData } from '@tradejs/infra/redis';

const getDataMock = jest.mocked(getData);
const getKeysMock = jest.mocked(getKeys);
const setDataMock = jest.mocked(setData);

const createJobRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1',
  userName: 'alice',
  status: 'completed',
  request: {
    strategyName: 'TrendLine',
    configId: 'TrendLine:base',
    periodMode: 'days',
    days: 30,
    ai: false,
    fast: false,
    interval: '15',
    connector: 'bybit',
  },
  command: 'tradejs',
  args: [],
  createdAt: '2026-07-16T10:00:00.000Z',
  updatedAt: '2026-07-16T10:01:00.000Z',
  runCount: 1,
  progress: {
    completed: 1,
    total: 1,
    percent: 100,
    averageProfit: null,
    winRate: null,
    successTests: 1,
    errorTests: 0,
  },
  logs: ['Backtest completed.'],
  ...overrides,
});

describe('backtest jobs helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes days requests and defaults operational fields', () => {
    expect(
      normalizeBacktestJobRequest({
        strategyName: 'TrendLine',
        configId: 'TrendLine:base',
        days: '45',
        ai: true,
      }),
    ).toEqual({
      strategyName: 'TrendLine',
      configId: 'TrendLine:base',
      periodMode: 'days',
      days: 45,
      ai: true,
      fast: false,
      interval: '15',
      connector: 'binance',
    });
  });

  it('builds TradeJS CLI args with range flags and resume skip', () => {
    const request = normalizeBacktestJobRequest({
      strategyName: 'TrendLine',
      configId: 'TrendLine:base',
      periodMode: 'range',
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
      interval: '60',
      connector: 'binance',
      ai: true,
      fast: true,
      tickers: 'BTCUSDT,ETHUSDT',
      testsLimit: 100,
      parallel: 2,
    });

    expect(
      buildBacktestCommandArgs({
        request,
        userName: 'alice',
        skip: 30,
      }),
    ).toEqual([
      'backtest',
      '--config',
      'TrendLine:base',
      '--user',
      'alice',
      '--timeframe',
      '60',
      '--connector',
      'binance',
      '--progressStep',
      '1',
      '--startTime',
      '1700000000000',
      '--endTime',
      '1700086400000',
      '--ai',
      '--fast',
      '--tickers',
      'BTCUSDT,ETHUSDT',
      '--parallel',
      '2',
      '--skip',
      '30',
      '--tests',
      '70',
    ]);
  });

  it('parses progress output as cumulative progress when resuming', () => {
    expect(
      parseBacktestProgressLine(
        '\u001b[32m20/70 [======]28% avg 12.34$ win 56.7% 10.0',
        30,
      ),
    ).toEqual({
      completed: 50,
      total: 100,
      averageProfit: 12.34,
      winRate: 56.7,
    });

    expect(parseBacktestProgressLine('tests: 70', 30)).toEqual({
      total: 100,
    });
  });

  it('validates persisted job records before processing them', () => {
    expect(isBacktestJobRecord(createJobRecord())).toBe(true);
    expect(isBacktestJobRecord(createJobRecord({ logs: undefined }))).toBe(
      false,
    );
    expect(isBacktestJobRecord(createJobRecord({ status: 'unexpected' }))).toBe(
      false,
    );
  });

  it('lists only valid records from the dedicated jobs namespace', async () => {
    getKeysMock.mockResolvedValue([
      'users:alice:backtests:jobs:job-1',
      'users:alice:backtests:jobs:invalid',
    ]);
    getDataMock.mockImplementation(async (key) =>
      key.endsWith(':job-1')
        ? createJobRecord()
        : { status: 'running', logs: undefined },
    );

    await expect(listBacktestJobs('alice')).resolves.toEqual([
      createJobRecord(),
    ]);
    expect(getKeysMock).toHaveBeenCalledWith('users:alice:backtests:jobs:');
    expect(getDataMock).not.toHaveBeenCalledWith(
      expect.stringContaining(':backtests:runs:'),
      expect.anything(),
    );
  });

  it('marks legacy completed jobs with no selected tests as failed', async () => {
    getKeysMock.mockResolvedValue(['users:alice:backtests:jobs:job-1']);
    getDataMock.mockResolvedValue(
      createJobRecord({
        progress: {
          completed: 0,
          total: null,
          percent: 0,
          averageProfit: null,
          winRate: null,
          successTests: null,
          errorTests: null,
        },
        logs: [
          'No tests selected (skip=0, limit=100000).',
          'Backtest completed.',
        ],
      }),
    );

    const [job] = await listBacktestJobs('alice');

    expect(job.status).toBe('failed');
    expect(job.error).toBe('No tests selected (skip=0, limit=100000).');
    expect(job.logs).toContain(
      'Backtest failed because no tests were generated.',
    );
    expect(setDataMock).toHaveBeenCalledWith(
      'users:alice:backtests:jobs:job-1',
      expect.objectContaining({ status: 'failed' }),
      expect.any(Object),
    );
  });
});
