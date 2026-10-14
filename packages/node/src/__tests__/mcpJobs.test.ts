/** @jest-environment node */
import {
  enqueueMcpJob,
  cancelMcpJob,
  readMcpJob,
  publicMcpJob,
  readMcpJobLogs,
  mcpJobStorageId,
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

const failedJob = async (logs: string[]) => {
  const job = await enqueueMcpJob(
    principal,
    'backtest',
    request,
    'log-test-key',
  );
  const failed: McpJob = { ...job, status: 'failed', exitCode: 1, logs };
  mockStore.set(mcpJobStorageId(job.userName, job.id), failed);
  return failed;
};

test('failed job logs can be paged without exposing private job fields or retrying it', async () => {
  const job = await failedJob([
    'command failed',
    'stack line 1',
    'stack line 2',
  ]);
  const page = await readMcpJobLogs(principal, job.id, 0, 2);
  expect(page).toEqual({
    jobId: job.id,
    status: 'failed',
    updatedAt: job.updatedAt,
    offset: 0,
    nextOffset: 2,
    retainedLines: 3,
    retention: 'worker_tail',
    lines: ['command failed', 'stack line 1'],
  });
  expect(await readMcpJobLogs(principal, job.id, 2, 2)).toMatchObject({
    lines: ['stack line 2'],
    nextOffset: null,
  });
  expect(await readMcpJobLogs(principal, job.id, 99)).toMatchObject({
    lines: [],
    nextOffset: null,
  });
  expect(await readMcpJob(principal.userName, job.id)).toEqual(job);
  expect(publicMcpJob(job)).not.toHaveProperty('logs');
});

test('log access enforces ownership and scopes for the actual job kind', async () => {
  const job = await failedJob(['diagnostic detail']);
  await expect(
    readMcpJobLogs({ ...principal, userName: 'bob' }, job.id),
  ).rejects.toThrow('Job not found');
  await expect(
    readMcpJobLogs({ ...principal, scopes: ['diagnostics:read'] }, job.id),
  ).rejects.toThrow('Insufficient scope');
  await expect(
    readMcpJobLogs(
      { ...principal, scopes: ['backtests:read'], clientId: 'another-client' },
      job.id,
    ),
  ).resolves.toMatchObject({ lines: ['diagnostic detail'] });
  mockStore.set(mcpJobStorageId(job.userName, job.id), {
    ...job,
    kind: 'runtime-feedback-replay',
  });
  await expect(readMcpJobLogs(principal, job.id)).rejects.toThrow(
    'Insufficient scope',
  );
  await expect(
    readMcpJobLogs({ ...principal, scopes: ['diagnostics:read'] }, job.id),
  ).resolves.toMatchObject({ lines: ['diagnostic detail'] });
  await expect(
    readMcpJobLogs({ ...principal, scopes: ['diagnostics:run'] }, job.id),
  ).resolves.toMatchObject({ lines: ['diagnostic detail'] });
});

test('stored logs are redacted again before returning and pagination stays below the response budget', async () => {
  const job = await failedJob([
    '\u001b[31mError: failed\u001b[0m',
    'Authorization: Bearer bearer-value',
    'Cookie: session=cookie-value; other=second-cookie',
    'REDIS_PASSWORD="password with spaces"',
    '{"apiKey":"api-value","access_token":"token-value"}',
    'redis://user:redis-password@cache:6379',
    'redis://:password-only@cache:6379',
    'https://host/path?token=query-token&ok=1',
    ...Array.from({ length: 100 }, () => '\u0000'.repeat(1000)),
  ]);
  const page = await readMcpJobLogs(principal, job.id, 0, 100);
  const text = JSON.stringify(page);
  for (const secret of [
    'bearer-value',
    'cookie-value',
    'second-cookie',
    'password with spaces',
    'api-value',
    'token-value',
    'redis-password',
    'password-only',
    'query-token',
  ])
    expect(text).not.toContain(secret);
  expect(page.lines[0]).toBe('Error: failed');
  expect(page.lines).toContain('redis://[redacted]@cache:6379');
  expect(Buffer.byteLength(text)).toBeLessThan(49000);
  expect(page.nextOffset).not.toBeNull();
  const rest = await readMcpJobLogs(principal, job.id, page.nextOffset!, 100);
  expect(rest.lines.length).toBeGreaterThan(0);
});

test('empty logs are available and invalid page boundaries or expired jobs fail clearly', async () => {
  const job = await failedJob([]);
  expect(await readMcpJobLogs(principal, job.id)).toMatchObject({
    lines: [],
    nextOffset: null,
    retainedLines: 0,
  });
  for (const [offset, limit] of [
    [-1, 1],
    [0.5, 1],
    [0, 0],
    [0, 101],
    [Number.MAX_SAFE_INTEGER + 1, 1],
  ])
    await expect(
      readMcpJobLogs(principal, job.id, offset, limit),
    ).rejects.toThrow('Select ');
  mockStore.delete(mcpJobStorageId(job.userName, job.id));
  await expect(readMcpJobLogs(principal, job.id)).rejects.toThrow(
    'Job not found',
  );
});
