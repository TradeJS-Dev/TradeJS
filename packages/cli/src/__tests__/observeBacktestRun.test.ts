/** @jest-environment node */

import { cliBacktestRunStorage } from '@tradejs/infra/redis';
import type { CliBacktestRun, Test } from '@tradejs/types';
import type { BacktestRunManifest } from '../lib/backtest/checkpoint';
import { observeBacktestRun } from '../lib/backtest/observeRun';

jest.mock('@tradejs/infra/redis', () => ({
  cliBacktestRunStorage: { put: jest.fn() },
}));

const testCase: Test = {
  userName: 'root',
  name: 'test',
  testId: 'test',
  testSuiteId: 'suite',
  symbol: 'BTCUSDT',
  strategyName: 'MaStrategy',
  strategyConfig: { MA_FAST: 10 },
  connectorName: 'bybit',
  options: { start: 1_000, end: 2_000 },
};

const manifest: BacktestRunManifest = {
  runId: 'run',
  status: 'running',
  userName: 'root',
  config: 'MaStrategy:grid',
  command: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  connectorName: 'bybit',
  interval: '15',
  window: { start: 1_000, end: 2_000, source: 'explicit' },
  preloadStart: 0,
  flags: {
    ai: false,
    backtestEntryDelayBars: 1,
    backtestPriceMode: 'open',
    cacheOnly: true,
    fast: true,
    ml: false,
  },
  testSuite: [testCase, { ...testCase, strategyConfig: { MA_FAST: 20 } }],
};

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

it('publishes resolved parameters and progress until the terminal update', async () => {
  jest.useFakeTimers();
  const snapshots: Array<{
    status: CliBacktestRun['status'];
    completed: number;
    ttl: number;
  }> = [];
  jest
    .mocked(cliBacktestRunStorage.put)
    .mockImplementation(async (run, ttl) => {
      snapshots.push({ status: run.status, completed: run.completed, ttl });
    });
  const observation = await observeBacktestRun(manifest, 0, 1);
  expect(cliBacktestRunStorage.put).toHaveBeenCalledWith(
    expect.objectContaining({
      startTime: 1_000,
      endTime: 2_000,
      settings: expect.objectContaining({ cacheOnly: true, parallel: 1 }),
      symbols: ['BTCUSDT'],
      parameters: [{ name: 'MA_FAST', values: ['10', '20'], truncated: false }],
    }),
    30,
  );
  observation?.progress(1);
  await jest.advanceTimersByTimeAsync(2_000);
  observation?.progress(2);
  await observation?.finish('completed');
  await jest.advanceTimersByTimeAsync(4_000);

  expect(snapshots).toEqual([
    { status: 'running', completed: 0, ttl: 30 },
    { status: 'running', completed: 1, ttl: 30 },
    { status: 'completed', completed: 2, ttl: 3600 },
  ]);
});

it('skips observation for a CLI process already tracked by the web app', async () => {
  jest.replaceProperty(process, 'env', {
    ...process.env,
    TRADEJS_BACKTEST_WEB_JOB: '1',
  });
  expect(await observeBacktestRun(manifest, 0, 1)).toBeUndefined();
  expect(cliBacktestRunStorage.put).not.toHaveBeenCalled();
});
