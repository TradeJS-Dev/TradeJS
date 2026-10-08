/** @jest-environment node */
import {
  enqueueMcpJob,
  cancelMcpJob,
  readMcpJob,
  publicMcpJob,
} from '../mcpJobs';
import type { McpJob, McpPrincipal } from '@tradejs/types';
const mockStore = new Map<string, unknown>();
const mockGrid = jest.fn();
jest.mock('node:fs/promises', () => ({
  readFile: async () => '{"packages":"frozen"}',
}));
jest.mock('@tradejs/infra/redis', () => ({
  getDataStrict: (...args: unknown[]) => mockGrid(...args),
  redisKeys: {
    backtestConfig: (user: string, id: string) => `config:${user}:${id}`,
  },
  mcpStorage: {
    get: async (id: string) =>
      mockStore.has(id) ? structuredClone(mockStore.get(id)) : null,
    put: async (id: string, value: unknown, _ttl: number, nx: boolean) => {
      if (nx && mockStore.has(id)) return false;
      mockStore.set(id, structuredClone(value));
      return true;
    },
    rateLimit: async () => true,
    compare: async (id: string, previous: unknown, next: unknown) => {
      if (JSON.stringify(mockStore.get(id)) !== JSON.stringify(previous))
        return false;
      mockStore.set(id, structuredClone(next));
      return true;
    },
  },
}));
const principal: McpPrincipal = {
  userName: 'alice',
  clientId: 'client',
  grantId: 'grant',
  scopes: ['backtests:run'],
};
const request = {
  configId: 'TrendLine:base',
  provider: 'bybit',
  interval: '15',
  symbols: ['BTCUSDT'],
  startTime: 1000,
  endTime: 86401000,
};
beforeEach(() => {
  mockStore.clear();
  mockStore.set('worker:heartbeat', { replayAvailable: false });
  mockGrid.mockResolvedValue({ A: [1, 2], B: [3] });
});
test('a queued request freezes the grid and reuses idempotency without creating a second job', async () => {
  const first = await enqueueMcpJob(
    principal,
    'backtest',
    request,
    'identical-key',
  );
  mockGrid.mockResolvedValue({ A: [999] });
  const repeated = await enqueueMcpJob(
    principal,
    'backtest',
    request,
    'identical-key',
  );
  expect(repeated.id).toBe(first.id);
  mockStore.delete('worker:heartbeat');
  expect(
    (await enqueueMcpJob(principal, 'backtest', request, 'identical-key')).id,
  ).toBe(first.id);
  expect(repeated.request.resolvedConfig).toEqual({ A: [1, 2], B: [3] });
  expect(first.args).toEqual(
    expect.arrayContaining([
      '--cacheOnly',
      '--fast',
      '--persistResults',
      '--parallel',
      '1',
    ]),
  );
  expect(publicMcpJob(first).request.resolvedConfig).toBeUndefined();
  await expect(
    enqueueMcpJob(
      principal,
      'backtest',
      { ...request, symbols: ['ETHUSDT'] },
      'identical-key',
    ),
  ).rejects.toThrow('Idempotency');
});
test('simultaneous conflicting submissions cannot share an idempotency key', async () => {
  const outcomes = await Promise.allSettled([
    enqueueMcpJob(principal, 'backtest', request, 'same-race-key'),
    enqueueMcpJob(
      principal,
      'backtest',
      { ...request, symbols: ['ETHUSDT'] },
      'same-race-key',
    ),
  ]);
  expect(
    outcomes.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
});
test('owned jobs are isolated and cancellation belongs to the submitting client', async () => {
  const job = await enqueueMcpJob(
    principal,
    'backtest',
    request,
    'cancel-this-job',
  );
  await expect(readMcpJob('bob', job.id)).rejects.toThrow('Job not found');
  await expect(
    cancelMcpJob({ ...principal, clientId: 'other' }, job.id),
  ).rejects.toThrow('Only the submitting');
  expect((await cancelMcpJob(principal, job.id)).status).toBe('cancelled');
});
test('resource and isolation limits reject work before queueing', async () => {
  mockGrid.mockResolvedValue({ A: Array.from({ length: 9 }, (_, i) => i) });
  await expect(
    enqueueMcpJob(principal, 'backtest', request, 'oversized-grid'),
  ).rejects.toThrow('eight');
  await expect(
    enqueueMcpJob(
      principal,
      'runtime-feedback-replay',
      { verifiedEvidencePath: '/verified' },
      'missing-isolation',
    ),
  ).rejects.toThrow('isolated Redis');
  mockStore.delete('worker:heartbeat');
  await expect(
    enqueueMcpJob(principal, 'backtest', request, 'worker-unavailable'),
  ).rejects.toThrow('unavailable');
  expect(
    [...mockStore.values()].filter(
      (value) => (value as McpJob).status === 'queued',
    ),
  ).toHaveLength(0);
});
