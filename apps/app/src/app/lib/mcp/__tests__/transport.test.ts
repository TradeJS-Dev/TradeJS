/** @jest-environment node */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { POST, GET } from '../../../mcp/route';
import { McpCursorError } from '@tradejs/node/mcp';
import type { McpPrincipal } from '@tradejs/types';
const mockVerification = jest
  .fn()
  .mockResolvedValue({ fresh: true, report: { ok: true } });
jest.mock('../verification', () => ({
  readDeploymentVerification: (...args: unknown[]) => mockVerification(...args),
}));
const mockPrincipal: McpPrincipal = {
  userName: 'alice',
  clientId: 'client',
  grantId: 'grant',
  scopes: ['market:read'],
};
let mockAuthenticated = true;
const mockReadLogs = jest.fn();
const mockReadRuntime = jest.fn();
const mockReadArtifact = jest.fn();
const mockRateLimit = jest.fn();
jest.mock('../oauth', () => ({
  authenticateMcp: async () => (mockAuthenticated ? mockPrincipal : null),
  fingerprint: (value: string) => value,
  mcpEnabled: () => true,
  mcpOrigin: () => 'https://tradejs.test',
  mcpResource: () => 'https://tradejs.test/mcp',
  oauthResponse: (body: unknown, status = 200, headers = {}) =>
    Response.json(body, { status, headers }),
}));
jest.mock('@tradejs/infra/redis', () => ({
  mcpStorage: {
    rateLimit: (...args: unknown[]) => mockRateLimit(...args),
    get: async () => null,
    put: async () => true,
  },
}));
jest.mock('../artifacts', () => ({
  readMcpArtifactChunk: (...args: unknown[]) => mockReadArtifact(...args),
}));
jest.mock('@tradejs/node/mcp', () => ({
  requireMcpDeployment: async () => ({
    id: 'production',
    accountId: 'alice-account',
    deploymentCompositionId: 'dc1:abc',
  }),
  mcpId: (value: string) => value,
  McpCursorError: class extends Error {
    constructor(readonly code: string) {
      super('Invalid storage cursor');
    }
  },
  readMcpRuntimePage: (...args: unknown[]) => mockReadRuntime(...args),
  redactMcpData: (value: unknown) => value,
  readMcpMarket: async () => ({ items: [{ symbol: 'BTCUSDT' }] }),
  readMcpJobLogs: (...args: unknown[]) => mockReadLogs(...args),
}));
beforeEach(() => {
  mockAuthenticated = true;
  mockPrincipal.scopes = ['market:read'];
  mockReadLogs.mockReset();
  mockReadRuntime.mockReset();
  mockReadArtifact.mockReset();
  mockRateLimit.mockReset().mockResolvedValue(true);
});
test('job_get_logs is a read-only scoped tool with validated pagination over HTTP', async () => {
  mockPrincipal.scopes = ['diagnostics:read'];
  const jobId = 'a'.repeat(64);
  const page = {
    jobId,
    status: 'failed',
    offset: 0,
    nextOffset: null,
    retainedLines: 1,
    retention: 'worker_tail',
    lines: ['Error: replay failed'],
  };
  mockReadLogs.mockResolvedValue(page);
  const client = new Client({ name: 'job-log-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://tradejs.test/mcp'), {
      fetch: async (url, init) =>
        init?.method === 'POST' ? POST(new Request(String(url), init)) : GET(),
    }),
  );
  try {
    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === 'job_get_logs')?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    const result = await client.callTool({
      name: 'job_get_logs',
      arguments: { jobId },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ data: page });
    expect(mockReadLogs).toHaveBeenCalledWith(mockPrincipal, jobId, 0, 50);
    for (const args of [
      { jobId, offset: -1 },
      { jobId, limit: 101 },
      { jobId, userName: 'bob' },
      { jobId: '/etc/passwd' },
    ]) {
      const invalid = await client.callTool({
        name: 'job_get_logs',
        arguments: args,
      });
      expect(invalid.isError).toBe(true);
    }
    expect(mockReadLogs).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
  }
});
test('SDK client initializes, lists scope-filtered tools and calls through stateless HTTP', async () => {
  const client = new Client({ name: 'compatibility-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL('https://tradejs.test/mcp'),
    {
      fetch: async (url, init) =>
        init?.method === 'POST' ? POST(new Request(String(url), init)) : GET(),
    },
  );
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      'tradejs_info',
      'market_list_symbols',
      'market_get_snapshot',
      'chart_get_context',
    ]);
    const result = await client.callTool({
      name: 'market_get_snapshot',
      arguments: { symbol: 'BTCUSDT' },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      data: { items: [{ symbol: 'BTCUSDT' }] },
    });
    const invalid = await client.callTool({
      name: 'market_get_snapshot',
      arguments: { symbol: 'BTCUSDT', userName: 'bob' },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await client.close();
  }
});
test('unauthenticated requests discover OAuth and foreign browser origins are rejected', async () => {
  mockAuthenticated = false;
  const response = await POST(
    new Request('https://tradejs.test/mcp', { method: 'POST', body: '{}' }),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get('WWW-Authenticate')).toContain(
    '/.well-known/oauth-protected-resource/mcp',
  );
  expect(
    (
      await POST(
        new Request('https://tradejs.test/mcp', {
          method: 'POST',
          headers: { origin: 'https://other.test' },
          body: '{}',
        }),
      )
    ).status,
  ).toBe(403);
});

// Keep one fixed window, including stateless initialization traffic on every chunk.
test('a complete large artifact download leaves the ordinary tool budget available', async () => {
  mockPrincipal.scopes = ['diagnostics:read', 'market:read'];
  const counts = new Map<string, number>();
  mockRateLimit.mockImplementation(async (key: string, maximum: number) => {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= maximum;
  });
  mockReadArtifact.mockResolvedValue({ encoding: 'base64', data: 'eA==' });
  const fetch = async (url: string | URL | Request, init?: RequestInit) =>
    init?.method === 'POST' ? POST(new Request(String(url), init)) : GET();
  for (let chunk = 0; chunk < Math.ceil(8806711 / 48000); chunk++) {
    const client = new Client({ name: 'artifact-download', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('https://tradejs.test/mcp'), {
        fetch,
      }),
    );
    try {
      await client.listTools();
      const result = await client.callTool({
        name: 'artifact_get',
        arguments: { artifactId: 'a'.repeat(64), offset: chunk * 48000 },
      });
      expect(result.isError).not.toBe(true);
    } finally {
      await client.close();
    }
  }
  const client = new Client({ name: 'ordinary-read', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://tradejs.test/mcp'), {
      fetch,
    }),
  );
  try {
    expect(
      (
        await client.callTool({
          name: 'market_get_snapshot',
          arguments: { symbol: 'BTCUSDT' },
        })
      ).isError,
    ).not.toBe(true);
  } finally {
    await client.close();
  }
  expect(mockReadArtifact).toHaveBeenCalledTimes(184);
});

const postRpc = (method: string, params?: unknown) =>
  POST(
    new Request('https://tradejs.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );

test('exhausted artifact quota returns Retry-After without blocking ordinary tools', async () => {
  mockPrincipal.scopes = ['diagnostics:read', 'market:read'];
  mockRateLimit.mockImplementation(
    async (key: string) => !key.startsWith('artifact-requests:'),
  );
  const limited = await postRpc('tools/call', {
    name: 'artifact_get',
    arguments: { artifactId: 'a'.repeat(64) },
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('Retry-After')).toBe('60');
  expect(mockReadArtifact).not.toHaveBeenCalled();
  expect(
    (
      await postRpc('tools/call', {
        name: 'market_get_snapshot',
        arguments: { symbol: 'BTCUSDT' },
      })
    ).status,
  ).toBe(200);
});

test('ordinary and protocol requests remain rate limited', async () => {
  mockRateLimit.mockResolvedValue(false);
  for (const method of ['ping', 'initialize', 'tools/list', 'tools/call']) {
    const limited = await postRpc(method, {
      name: 'market_get_snapshot',
      arguments: { symbol: 'BTCUSDT' },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  }
});

test('artifact names without diagnostics scope cannot obtain a download budget', async () => {
  await postRpc('tools/call', {
    name: 'artifact_get',
    arguments: { artifactId: 'a'.repeat(64) },
  });
  expect(mockRateLimit).toHaveBeenCalledWith('requests:alice:client', 120, 60);
  expect(mockReadArtifact).not.toHaveBeenCalled();
});

test('invalid JSON consumes the ordinary budget and oversized bodies stay bounded', async () => {
  const request = (body: string) =>
    new Request('https://tradejs.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body,
    });
  await POST(request('{'));
  expect(mockRateLimit).toHaveBeenCalledWith('requests:alice:client', 120, 60);
  mockRateLimit.mockClear();
  expect((await POST(request('x'.repeat(65537)))).status).toBe(413);
  expect(mockRateLimit).not.toHaveBeenCalled();
});

test('runtime cursor errors and continuation guidance survive the HTTP tool boundary', async () => {
  mockPrincipal.scopes = ['runtime:read'];
  mockReadRuntime.mockRejectedValue(new McpCursorError('CURSOR_EXPIRED'));
  const client = new Client({ name: 'runtime-cursor-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://tradejs.test/mcp'), {
      fetch: async (url, init) =>
        init?.method === 'POST' ? POST(new Request(String(url), init)) : GET(),
    }),
  );
  try {
    const args = {
      deploymentId: 'production',
      cursor: 'a'.repeat(64),
      startTime: 1000,
      endTime: 2000,
      limit: 2,
    };
    const result = await client.callTool({
      name: 'runtime_list_evaluations',
      arguments: args,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      data: {
        code: 'CURSOR_EXPIRED',
        recovery: expect.stringContaining('same window'),
      },
    });
    expect(mockReadRuntime).toHaveBeenCalledWith('alice', 'evaluations', args);
    expect(
      (
        await client.callTool({
          name: 'runtime_list_evaluations',
          arguments: { ...args, limit: 51 },
        })
      ).isError,
    ).toBe(true);
    expect(mockReadRuntime).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
  }
});

test('deployment verification is scoped, read-only and bound to the authenticated account', async () => {
  mockPrincipal.scopes = ['runtime:read'];
  const client = new Client({ name: 'verification-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://tradejs.test/mcp'), {
      fetch: async (url, init) =>
        init?.method === 'POST' ? POST(new Request(String(url), init)) : GET(),
    }),
  );
  try {
    const tools = await client.listTools();
    expect(
      tools.tools.find((t) => t.name === 'runtime_get_verification')
        ?.annotations?.readOnlyHint,
    ).toBe(true);
    await client.callTool({
      name: 'runtime_get_verification',
      arguments: { deploymentId: 'production' },
    });
    expect(mockVerification).toHaveBeenCalledWith(expect.any(String), {
      userName: 'alice',
      deploymentId: 'production',
      accountId: 'alice-account',
      deploymentCompositionId: 'dc1:abc',
    });
  } finally {
    await client.close();
  }
});
