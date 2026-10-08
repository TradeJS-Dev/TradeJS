/** @jest-environment node */
import { EventEmitter } from 'node:events';
import { main } from '../mcpWorker';
import type { McpJob } from '@tradejs/types';
const mockJobs = new Map<string, unknown>();
let mockController = new AbortController();
const mockSpawn = jest.fn();
const mockSetConfig = jest.fn();
jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));
jest.mock('node:fs/promises', () => ({ mkdir: async () => undefined }));
jest.mock('@tradejs/node/mcp', () => ({
  MCP_JOB_TTL: 100,
  mcpPackageManifestHash: async () => 'manifest',
  mcpJobStorageId: (_user: string, id: string) => `jobs:${id}`,
  mcpJobDirectory: (job: McpJob) => `/test/data/${job.id}`,
}));
jest.mock('@tradejs/infra/redis', () => ({
  redisKeys: { backtestConfig: (_user: string, id: string) => id },
  setDataStrict: (...args: unknown[]) => mockSetConfig(...args),
  mcpStorage: {
    put: async (key: string, value: unknown, _ttl: number, nx: boolean) => {
      if (nx && mockJobs.has(key)) return false;
      mockJobs.set(key, structuredClone(value));
      return true;
    },
    get: async (key: string) =>
      mockJobs.has(key) ? structuredClone(mockJobs.get(key)) : null,
    scan: async () => ({
      cursor: '0',
      ids: [...mockJobs.keys()].filter((key) => key.startsWith('jobs:')),
    }),
    compare: async (key: string, before: unknown, after: unknown) => {
      if (JSON.stringify(mockJobs.get(key)) !== JSON.stringify(before))
        return false;
      mockJobs.set(key, structuredClone(after));
      const job = after as McpJob;
      if (job.status === 'completed' || job.status === 'failed')
        mockController.abort();
      return true;
    },
    release: async () => true,
    remove: async (key: string) => mockJobs.delete(key),
  },
}));
const job = (
  status: McpJob['status'],
  overrides: Partial<McpJob> = {},
): McpJob => ({
  id: 'id',
  userName: 'alice',
  clientId: 'client',
  kind: 'backtest',
  status,
  request: { frozenConfigId: 'frozen', resolvedConfig: { A: [1] } },
  args: ['backtest', '--cacheOnly'],
  createdAt: 1,
  updatedAt: 1,
  logs: [],
  outputId: 'id',
  packageManifestSha256: 'manifest',
  ...overrides,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockJobs.clear();
  mockController = new AbortController();
  mockSpawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 999999,
    });
    queueMicrotask(() => child.emit('exit', 0));
    return child;
  });
});
test('restart marks interrupted work failed and never starts it again', async () => {
  mockJobs.set('jobs:id', job('running'));
  await main({ signal: mockController.signal });
  expect((mockJobs.get('jobs:id') as McpJob).status).toBe('failed');
  expect(mockSpawn).not.toHaveBeenCalled();
});
test('worker executes a frozen cached job once and persists completion', async () => {
  mockJobs.set('jobs:id', job('queued'));
  await main({ signal: mockController.signal });
  expect(mockSetConfig).toHaveBeenCalledWith(
    'frozen',
    { A: [1] },
    expect.any(Object),
  );
  expect(mockSpawn).toHaveBeenCalledTimes(1);
  expect((mockJobs.get('jobs:id') as McpJob).status).toBe('completed');
});
test('package drift fails before starting any process', async () => {
  mockJobs.set(
    'jobs:id',
    job('queued', { packageManifestSha256: 'other-manifest' }),
  );
  await main({ signal: mockController.signal });
  expect(mockSpawn).not.toHaveBeenCalled();
  expect((mockJobs.get('jobs:id') as McpJob).error).toContain(
    'composition changed',
  );
});
test('feedback subprocess receives isolated storage, read-only SQL and no inherited secret loader', async () => {
  process.env.MCP_REPLAY_REDIS_HOST = 'isolated-replay';
  process.env.OPENAI_API_KEY = 'test-secret';
  mockJobs.set(
    'jobs:id',
    job('queued', {
      kind: 'runtime-feedback-replay',
      args: ['runtime-feedback-replay'],
    }),
  );
  try {
    await main({ signal: mockController.signal });
    const options = mockSpawn.mock.calls[0][2];
    expect(options.env).toMatchObject({
      REDIS_HOST: 'isolated-replay',
      DOTENV_CONFIG_PATH: '/dev/null',
      MAKE_ORDERS: 'false',
      TRADEJS_TIMESCALE_READ_ONLY: 'true',
    });
    expect(options.env.OPENAI_API_KEY).toBeUndefined();
    expect(options.env.PGOPTIONS).toContain('default_transaction_read_only=on');
  } finally {
    delete process.env.OPENAI_API_KEY;
    delete process.env.MCP_REPLAY_REDIS_HOST;
  }
});
