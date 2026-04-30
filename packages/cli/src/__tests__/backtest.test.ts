jest.mock('args', () => ({
  __esModule: true,
  default: {
    example: jest.fn(),
    option: jest.fn(),
    parse: jest.fn(() => ({
      timeframe: '15',
      progressStep: 100,
      tests: 50,
      skip: 0,
      parallel: 4,
      top: 10,
      user: 'root',
      config: 'TrendLine:research',
      connector: 'bybit',
    })),
  },
}));

jest.mock('@tradejs/node/connectors', () => ({
  DEFAULT_CONNECTOR_NAME: 'bybit',
  getConnectorCreatorByName: jest.fn(),
  resolveConnectorName: jest.fn(),
}));

jest.mock('@tradejs/node/cli', () => ({
  drawStatInCLI: jest.fn(() => []),
  getTickers: jest.fn(),
  update: jest.fn(),
}));

jest.mock('@tradejs/core/backtest', () => ({
  calculateStatsFull: jest.fn(),
  createTestSuite: jest.fn(),
  mergeConfigs: jest.fn(),
  parseTestName: jest.fn((value: string) => ({
    symbol: value.split('__')[0],
    testId: value.split('__')[1] || value,
  })),
}));

jest.mock('@tradejs/core/data', () => ({
  toJson: jest.fn(),
}));

jest.mock('@tradejs/core/constants', () => ({
  BACKTEST_DEFAULT_DAYS: 30,
  BACKTEST_PRELOAD_DAYS: 5,
  TESTS_LIMIT: 100,
  TESTS_TOP_LIMIT: 10,
  TTL_1D: 86400,
  TTL_1M: 2592000,
}));

jest.mock('@tradejs/core/time', () => ({
  formatUnix: jest.fn(),
  getBacktestPreloadStart: jest.fn(),
  getTimestamp: jest.fn(),
}));

jest.mock('@tradejs/infra/redis', () => ({
  setData: jest.fn(),
  getData: jest.fn(),
  redisKeys: {
    testSummaries: (userName: string) =>
      `users:${userName}:tests:index:summary`,
  },
}));

jest.mock('../lib/derivativesContextBackfill', () => ({
  backfillDerivativesContextForBacktest: jest.fn(),
  shouldBackfillDerivativesContextForBacktest: jest.fn(),
}));

jest.mock('../lib/cliArgs', () => ({
  normalizeCliArgv: jest.fn((argv: string[]) => argv),
}));

jest.mock('../lib/timeWindow', () => ({
  resolveTimeWindow: jest.fn(),
}));

import {
  mergePersistedTestSummaries,
  resolveEffectiveParallel,
  resolveWorkerHeapMb,
} from '../scripts/backtest';

describe('backtest script helpers', () => {
  it('clamps worker heap env to a minimum floor and falls back on invalid values', () => {
    expect(resolveWorkerHeapMb('128', 8192)).toBe(256);
    expect(resolveWorkerHeapMb('2048', 8192)).toBe(2048);
    expect(resolveWorkerHeapMb('not-a-number', 4096)).toBe(4096);
  });

  it('caps parallelism by env max and never drops below one', () => {
    expect(resolveEffectiveParallel('6', '2', 8)).toBe(2);
    expect(resolveEffectiveParallel('0', '3', 8)).toBe(3);
    expect(resolveEffectiveParallel('bad', 'bad', 5)).toBe(5);
    expect(resolveEffectiveParallel('-10', '-2', 5)).toBe(1);
  });

  it('merges persisted summary index with valid legacy items and overrides duplicates', () => {
    const merged = mergePersistedTestSummaries(
      [
        {
          value: 'BTCUSDT__1',
          label: 'BTCUSDT_1',
          data: { strategyName: 'TrendLine', netProfit: 10 },
        },
        {
          value: 'ETHUSDT__2',
          label: 'ETHUSDT_2',
          data: { strategyName: 'Breakout', netProfit: 7 },
        },
        {
          value: 'BROKEN__3',
          label: 'BROKEN_3',
          data: { netProfit: 1 },
        } as any,
      ],
      new Map([
        [
          'TrendLine:BTCUSDT__1',
          {
            value: 'BTCUSDT__1',
            label: 'BTCUSDT_1',
            data: { strategyName: 'TrendLine', netProfit: 42 },
          },
        ],
        [
          'VolumeDivergence:SOLUSDT__4',
          {
            value: 'SOLUSDT__4',
            label: 'SOLUSDT_4',
            data: { strategyName: 'VolumeDivergence', netProfit: 15 },
          },
        ],
      ]),
    );

    expect(merged).toEqual([
      {
        value: 'BTCUSDT__1',
        label: 'BTCUSDT_1',
        data: { strategyName: 'TrendLine', netProfit: 42 },
      },
      {
        value: 'ETHUSDT__2',
        label: 'ETHUSDT_2',
        data: { strategyName: 'Breakout', netProfit: 7 },
      },
      {
        value: 'SOLUSDT__4',
        label: 'SOLUSDT_4',
        data: { strategyName: 'VolumeDivergence', netProfit: 15 },
      },
    ]);
  });
});
