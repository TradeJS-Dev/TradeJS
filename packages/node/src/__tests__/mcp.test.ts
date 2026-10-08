/** @jest-environment node */
import {
  readMcpRuntimePage,
  readMcpChart,
  readMcpBacktestResult,
  readMcpSignal,
  readMcpDeployments,
  redactMcpData,
} from '../mcp';
const mockConnector = jest.fn();
const mockIndicators = jest.fn();
const mockStorage = new Map<string, unknown>();
const mockRead = jest.fn();
const mockScan = jest.fn();
const mockHash = jest.fn();
const mockField = jest.fn();
const mockAccount = jest.fn();
jest.mock('@tradejs/core/indicators', () => ({
  createIndicators: (...args: unknown[]) => mockIndicators(...args),
}));
jest.mock('../registry', () => ({
  ensureIndicatorPluginsLoaded: async () => undefined,
}));
jest.mock('../connectors', () => ({
  getConnectorCreatorByProvider: async () => mockConnector,
}));
jest.mock('../runtimeStrategies', () => ({
  listRuntimeDeployments: async () => [
    { id: 'production', accountId: 'account' },
    { id: 'other', accountId: 'other-account' },
  ],
  loadResolvedRuntimeStrategies: jest.fn(),
}));
jest.mock('@tradejs/infra/runtimeHeartbeats', () => ({
  getRuntimeDeploymentHeartbeat: async () => null,
}));
jest.mock('@tradejs/infra/tradingAccounts', () => ({
  getTradingAccount: (...args: unknown[]) => mockAccount(...args),
}));
jest.mock('@tradejs/infra/redis', () => ({
  getDataStrict: (...args: unknown[]) => mockRead(...args),
  getHashJsonField: (...args: unknown[]) => mockField(...args),
  scanDataKeys: (...args: unknown[]) => mockScan(...args),
  scanHashJson: (...args: unknown[]) => mockHash(...args),
  mcpStorage: {
    get: async (key: string) => mockStorage.get(key),
    put: async (key: string, value: unknown) => {
      mockStorage.set(key, structuredClone(value));
      return true;
    },
  },
  redisKeys: {
    runtimeSignalBuckets: (user: string) => `users:${user}:signals:days:`,
    runtimeSignalEvaluationBuckets: (user: string) =>
      `users:${user}:evaluations:days:`,
    runtimeTrades: (user: string) => `users:${user}:trades:`,
    storeSignal: (symbol: string, id: string) => `store:${symbol}:${id}`,
    runtimeSignalBucket: (user: string, day: string, strategy: string) =>
      `users:${user}:${day}:${strategy}`,
  },
}));
const request = {
  deploymentId: 'production',
  cursor: '0',
  startTime: 1000,
  endTime: 10000,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockStorage.clear();
  mockAccount.mockImplementation(async (_user: string, account: string) =>
    account === 'account' ? {} : null,
  );
  mockScan.mockResolvedValue({ cursor: '0', keys: ['bucket'] });
});
test('only account-bound deployments are visible', async () => {
  expect(
    (await readMcpDeployments('alice')).deployments.map((row) => row.id),
  ).toEqual(['production']);
  await expect(
    readMcpRuntimePage('alice', 'evaluations', {
      ...request,
      deploymentId: 'other',
    }),
  ).rejects.toThrow('Deployment unavailable');
});
test('runtime hash pages retain pending records and bind cursors to user and filters', async () => {
  mockHash.mockResolvedValue({
    cursor: '0',
    values: Array.from({ length: 55 }, (_, index) => ({
      evaluationId: index,
      deploymentId: 'production',
      accountId: 'account',
      timestamp: 2000,
    })),
  });
  const first = await readMcpRuntimePage('alice', 'evaluations', request);
  expect(first.items).toHaveLength(50);
  expect(first.cursor).not.toBe('0');
  await expect(
    readMcpRuntimePage('bob', 'evaluations', {
      ...request,
      cursor: first.cursor,
    }),
  ).rejects.toThrow('Invalid storage cursor');
  await expect(
    readMcpRuntimePage('alice', 'evaluations', {
      ...request,
      cursor: first.cursor,
      endTime: 9000,
    }),
  ).rejects.toThrow();
  const last = await readMcpRuntimePage('alice', 'evaluations', {
    ...request,
    cursor: first.cursor,
  });
  expect(last.items).toHaveLength(5);
  expect(last.cursor).toBe('0');
  expect(mockHash).toHaveBeenCalledTimes(1);
});
test('signal details require a user-owned bucket reference and matching deployment/account', async () => {
  mockField.mockResolvedValue(null);
  await expect(
    readMcpSignal('alice', 'id', 'production', 2000, 'TrendLine'),
  ).rejects.toThrow('Signal not found');
  expect(mockRead).not.toHaveBeenCalled();
  mockField.mockResolvedValue({ symbol: 'BTCUSDT' });
  mockRead.mockResolvedValue({
    deploymentId: 'production',
    accountId: 'other-account',
  });
  await expect(
    readMcpSignal('alice', 'id', 'production', 2000, 'TrendLine'),
  ).rejects.toThrow();
});
test('shared payloads cannot leak records from another deployment, account or user', async () => {
  mockHash.mockResolvedValue({
    cursor: '0',
    values: [
      {
        deploymentId: 'production',
        accountId: 'account',
        userName: 'alice',
        timestamp: 2000,
        figures: ['large'],
        indicators: {},
      },
      {
        deploymentId: 'production',
        accountId: 'account',
        userName: 'bob',
        timestamp: 2000,
      },
      { deploymentId: 'other', accountId: 'account', timestamp: 2000 },
      {
        deploymentId: 'production',
        accountId: 'other-account',
        timestamp: 2000,
      },
    ],
  });
  const result = await readMcpRuntimePage('alice', 'evaluations', request);
  expect(result.items).toEqual([
    {
      deploymentId: 'production',
      accountId: 'account',
      userName: 'alice',
      timestamp: 2000,
    },
  ]);
  expect(
    redactMcpData({
      config: { API_KEY: 'secret', accessToken: 'token', safe: 1 },
    }),
  ).toEqual({ config: { safe: 1 } });
});

test('chart context excludes the forming candle, warms indicators and bounds returned series', async () => {
  const candles = [0, 60000, 120000, 180000].map((timestamp) => ({
    timestamp,
  }));
  mockConnector.mockReturnValue({ kline: async () => candles });
  mockIndicators.mockReturnValue({
    result: () => ({ maFast: [1, 2, 3], macd: [4, 5, 6] }),
  });
  const context = await readMcpChart('alice', {
    provider: 'bybit',
    universe: 'crypto',
    symbol: 'BTCUSDT',
    interval: '1',
    endTime: 180001,
    bars: 2,
    cacheOnly: true,
    indicatorNames: ['maFast'],
  });
  expect(context.candles.map((candle) => candle.timestamp)).toEqual([
    60000, 120000,
  ]);
  expect(context.indicators).toEqual({ maFast: [2, 3] });
  expect(mockIndicators.mock.calls[0][0]).toHaveLength(3);
  expect(context.closedCandlesOnly).toBe(true);
});

test('saved results paginate all result groups without returning filesystem paths or raw errors', async () => {
  mockRead.mockResolvedValue({
    config: 'TrendLine:mcp',
    results: [{ id: 1 }, { id: 2 }, { id: 3 }],
    resultsByTickers: [{ id: 4 }],
    markdownReportPath: '/private/path',
    errors: ['raw error'],
  });
  const result = await readMcpBacktestResult(
    'alice',
    'TrendLine:mcp:timestamp',
    0,
    2,
  );
  expect(result.result.results).toEqual([{ id: 1 }, { id: 2 }]);
  expect(result.nextOffset).toBe(2);
  expect(result.result).not.toHaveProperty('markdownReportPath');
  expect(result.result).not.toHaveProperty('errors');
  expect(mockRead).toHaveBeenCalledWith(
    'users:alice:backtests:results:TrendLine:mcp:timestamp',
  );
});
