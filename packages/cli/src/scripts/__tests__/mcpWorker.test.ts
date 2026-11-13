/** @jest-environment node */
import { EventEmitter } from 'node:events';
import { main } from '../mcpWorker';
import type { McpJob } from '@tradejs/types';
const mockJobs = new Map<string, unknown>();
let mockController = new AbortController();
const mockSpawn = jest.fn();
const mockSetConfig = jest.fn();
const mockReplayProcess = jest.fn();
const mockDiscoverEvidence = jest.fn();
const mockVerifyEvidence = jest.fn();
const mockVerifyReplaySource = jest.fn();
const mockReadFile = jest.fn();
const mockReadResult = jest.fn();
jest.mock('../../lib/mcpReplayProcess', () => ({
  buildMcpReplayProcess: (...args: unknown[]) => mockReplayProcess(...args),
}));
jest.mock('@tradejs/node/diagnostics', () => ({
  discoverRuntimeEvidenceBundles: (...args: unknown[]) =>
    mockDiscoverEvidence(...args),
  verifyRuntimeEvidenceBundle: (...args: unknown[]) =>
    mockVerifyEvidence(...args),
  verifyRuntimeFeedbackReplaySource: (...args: unknown[]) =>
    mockVerifyReplaySource(...args),
}));
jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));
jest.mock('node:fs/promises', () => ({
  mkdir: async () => undefined,
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));
jest.mock('@tradejs/node/mcp', () => ({
  redactMcpJobLog: jest.requireActual('@tradejs/node/mcp').redactMcpJobLog,
  MCP_JOB_TTL: 100,
  mcpPackageManifestHash: async () => 'manifest',
  mcpJobStorageId: (_user: string, id: string) => `jobs:${id}`,
  mcpJobDirectory: (job: McpJob) => `/test/data/${job.id}`,
  mcpProjectRoot: () => '/test',
  isMcpRecord: jest.requireActual('@tradejs/node/mcp').isMcpRecord,
  mcpId: jest.requireActual('@tradejs/node/mcp').mcpId,
  mcpArtifactLocationId:
    jest.requireActual('@tradejs/node/mcp').mcpArtifactLocationId,
}));
jest.mock('@tradejs/infra/redis', () => ({
  redisKeys: {
    backtestConfig: (_user: string, id: string) => id,
    backtestResults: (_user: string, config: string, timestamp: string) =>
      `${config}:${timestamp}`,
  },
  getDataStrict: (...args: unknown[]) => mockReadResult(...args),
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
  request:
    overrides.kind === 'runtime-feedback-replay'
      ? {
          verifiedEvidencePath:
            '/test/data/runtime-evidence/source/runtime-evidence.json',
          deploymentId: 'production',
        }
      : { frozenConfigId: 'frozen', resolvedConfig: { A: [1] } },
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
  mockReadResult.mockReset().mockResolvedValue({ results: [] });
  mockReadFile.mockImplementation(async (file: string) => {
    if (!file.endsWith('/completed/production/source.json'))
      throw new Error('not published');
    return JSON.stringify({
      schemaVersion: 1,
      runtimeEvidenceArtifactId: 'source',
      runtimeFeedbackBundle:
        '/host/data/runtime-feedback/ready/production/1970/01/01/source/run',
    });
  });
  mockVerifyEvidence.mockResolvedValue({
    manifest: {
      artifactId: 'source',
      userName: 'alice',
      deploymentId: 'production',
      window: { endTime: 10000 },
    },
  });
  mockVerifyReplaySource.mockResolvedValue({
    feedback: {
      manifest: {
        artifactId: 'source_run',
        payloads: { replayEvidence: { sha256: 'a'.repeat(64) } },
      },
    },
  });
  mockReplayProcess.mockResolvedValue({
    executable: process.execPath,
    args: ['host-request'],
  });
  mockJobs.clear();
  mockController = new AbortController();
  mockSpawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 999999,
    });
    queueMicrotask(() => {
      child.emit('exit', 0);
      child.emit('close', 0);
    });
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
  const timestamp =
    mockSpawn.mock.calls[0][2].env.MCP_BACKTEST_RESULT_TIMESTAMP;
  expect(timestamp).toMatch(/^\d{12}$/);
  expect(mockReadResult).toHaveBeenCalledWith(`frozen:${timestamp}`);
  expect(mockJobs.get('jobs:id')).toMatchObject({
    status: 'completed',
    resultId: `frozen:${timestamp}`,
  });
});
test('worker reports a missing persisted result after a successful process exit', async () => {
  mockReadResult.mockResolvedValue(null);
  mockJobs.set('jobs:id', job('queued'));
  await main({ signal: mockController.signal });
  expect(mockJobs.get('jobs:id')).toMatchObject({
    status: 'failed',
    error: 'Job finished but its saved output could not be verified',
  });
  expect(mockJobs.get('jobs:id')).not.toHaveProperty('resultId');
});
test('worker indexes every verified evidence composition before publishing completion', async () => {
  const request = {
    deploymentId: 'production',
    startTime: 1000,
    endTime: 2000,
  };
  const directories = ['/test/data/id/a', '/test/data/id/b'];
  mockDiscoverEvidence.mockResolvedValue(directories);
  mockVerifyEvidence.mockImplementation(async (bundleDir: string) => ({
    manifest: {
      userName: 'alice',
      deploymentId: 'production',
      artifactId: bundleDir.at(-1),
      window: { startTime: request.startTime, endTime: request.endTime },
      payload: { sha256: 'a'.repeat(64) },
    },
  }));
  mockJobs.set('jobs:id', job('queued', { kind: 'runtime-evidence', request }));
  await main({ signal: mockController.signal });

  const { mcpArtifactLocationId, mcpId } =
    jest.requireActual('@tradejs/node/mcp');
  const ids = directories.map((dir) =>
    mcpId(`${dir.at(-1)}:${'a'.repeat(64)}`),
  );
  expect(mockJobs.get('jobs:id')).toMatchObject({
    status: 'completed',
    artifactIds: ids,
  });
  expect(
    ids.map((id) => mockJobs.get(mcpArtifactLocationId('alice', id))),
  ).toEqual(directories);
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
    expect(mockReplayProcess).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'id' }),
    );
    expect(mockSpawn.mock.calls[0].slice(0, 2)).toEqual([
      process.execPath,
      ['host-request'],
    ]);
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

test('image runner prerequisite errors persist without starting a current-image fallback', async () => {
  mockReplayProcess.mockRejectedValue(
    new Error('Image-bound replay requires explicit mounts'),
  );
  mockJobs.set('jobs:id', job('queued', { kind: 'runtime-feedback-replay' }));
  await main({ signal: mockController.signal });
  expect(mockSpawn).not.toHaveBeenCalled();
  expect((mockJobs.get('jobs:id') as McpJob).error).toContain(
    'explicit mounts',
  );
});

test('failed replay exposes redacted host details after stderr is fully drained', async () => {
  mockJobs.set('jobs:id', job('queued', { kind: 'runtime-feedback-replay' }));
  mockSpawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 999999,
    });
    queueMicrotask(() => {
      child.stdout.emit(
        'data',
        Buffer.from(
          'Host image-bound replay failed; inspect retained host replay logs\n',
        ),
      );
      child.emit('exit', 1);
      queueMicrotask(() => {
        child.stderr.emit(
          'data',
          Buffer.from(
            'Host replay: Insufficient host memory for replay: available_kb=6044784 password=private-value\n',
          ),
        );
        child.emit('close', 1);
      });
    });
    return child;
  });
  await main({ signal: mockController.signal });
  const saved = mockJobs.get('jobs:id') as McpJob;
  expect(saved.status).toBe('failed');
  expect(saved.error).toContain('available_kb=6044784');
  expect(saved.error).toContain('[redacted]');
  expect(JSON.stringify(saved)).not.toContain('private-value');
  expect(mockSpawn).toHaveBeenCalledTimes(1);
});

test('host resource waiting exposes memory telemetry', async () => {
  mockJobs.set('jobs:id', job('queued', { kind: 'runtime-feedback-replay' }));
  mockReadFile.mockImplementation(async (file: string) =>
    JSON.stringify(
      file.endsWith('heartbeat.json')
        ? {
            protocolVersion: 2,
            observedAt: Date.now(),
            readiness: 'waiting_resources',
            memoryAvailableKb: 6082188,
            minimumAvailableKb: 7340032,
          }
        : { status: 'waiting_resources' },
    ),
  );
  let waiting: McpJob | undefined;
  let workerHeartbeat: unknown;
  mockSpawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 999999,
    });
    setTimeout(() => {
      waiting = mockJobs.get('jobs:id') as McpJob;
      workerHeartbeat = mockJobs.get('worker:heartbeat');
      child.emit('close', 0);
    }, 1200);
    return child;
  });
  await main({ signal: mockController.signal });
  expect(workerHeartbeat).toMatchObject({
    replayResources: {
      memoryAvailableKb: 6082188,
      minimumAvailableKb: 7340032,
      memoryDeficitKb: 1257844,
    },
  });
  expect(waiting?.status).toBe('waiting_resources');
  expect(waiting?.startedAt).toBeUndefined();
  expect(mockSpawn).toHaveBeenCalledTimes(1);
});

test('worker restart reattaches a waiting host request without failing it', async () => {
  mockJobs.set(
    'jobs:id',
    job('waiting_executor', { kind: 'runtime-feedback-replay' }),
  );
  await main({ signal: mockController.signal });
  expect(mockReplayProcess).toHaveBeenCalledTimes(1);
  expect(mockJobs.get('jobs:id')).toMatchObject({
    status: 'completed',
    artifactIds: [expect.stringMatching(/^[a-f0-9]{64}$/)],
  });
  expect(mockVerifyReplaySource).toHaveBeenCalledWith({
    bundleDir:
      '/test/data/runtime-feedback/ready/production/1970/01/01/source/run',
    runtimeEvidenceBundleDir: '/test/data/runtime-evidence/source',
  });
});

test('waiting for resources does not consume the one-hour replay execution budget', async () => {
  jest.useFakeTimers();
  const kill = jest.spyOn(process, 'kill').mockReturnValue(true);
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    pid: 999999,
  });
  mockJobs.set('jobs:id', job('queued', { kind: 'runtime-feedback-replay' }));
  mockReadFile.mockImplementation(async (file: string) =>
    JSON.stringify(
      file.endsWith('heartbeat.json')
        ? {
            protocolVersion: 2,
            observedAt: Date.now(),
            readiness: 'waiting_resources',
          }
        : { status: 'waiting_resources' },
    ),
  );
  mockSpawn.mockReturnValue(child);
  const running = main({ signal: mockController.signal });
  try {
    await jest.advanceTimersByTimeAsync(3601000);
    expect((mockJobs.get('jobs:id') as McpJob).status).toBe(
      'waiting_resources',
    );
    expect(kill).not.toHaveBeenCalled();
    child.emit('close', 0);
    await running;
  } finally {
    mockController.abort();
    kill.mockRestore();
    jest.useRealTimers();
  }
});

test('a waiting exact-image replay can attach after the worker package changes', async () => {
  mockJobs.set(
    'jobs:id',
    job('waiting_resources', {
      kind: 'runtime-feedback-replay',
      packageManifestSha256: 'previous-worker-manifest',
    }),
  );
  await main({ signal: mockController.signal });
  expect(mockReplayProcess).toHaveBeenCalledTimes(1);
  expect((mockJobs.get('jobs:id') as McpJob).status).toBe('completed');
});
