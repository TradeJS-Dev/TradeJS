/** @jest-environment node */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { POST, GET } from '../../../mcp/route';
import type { McpPrincipal } from '@tradejs/types';
const mockPrincipal: McpPrincipal = {
  userName: 'alice',
  clientId: 'client',
  grantId: 'grant',
  scopes: ['market:read'],
};
let mockAuthenticated = true;
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
    rateLimit: async () => true,
    get: async () => null,
    put: async () => true,
  },
}));
jest.mock('../artifacts', () => ({}));
jest.mock('@tradejs/node/mcp', () => ({
  mcpId: (value: string) => value,
  redactMcpData: (value: unknown) => value,
  readMcpMarket: async () => ({ items: [{ symbol: 'BTCUSDT' }] }),
}));
beforeEach(() => {
  mockAuthenticated = true;
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
