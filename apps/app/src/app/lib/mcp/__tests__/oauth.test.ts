/** @jest-environment node */
import { createHash } from 'node:crypto';
import OAuth2Server from '@node-oauth/oauth2-server';
import {
  authenticateMcp,
  authorizeConsent,
  consumeConsent,
  createOAuthServer,
  listConnections,
  mcpResource,
  prepareConsent,
  registerOAuthClient,
  revokeGrant,
  redirectMatches,
} from '../oauth';

const mockStore = new Map<string, unknown>();
const mockUser = jest.fn(async () => ({ passwordHash: 'not-exported' }));
jest.mock('@tradejs/infra/redis', () => ({
  getDataStrict: (...args: unknown[]) => mockUser(...(args as [])),
  redisKeys: { user: (name: string) => `user:${name}` },
  mcpStorage: {
    get: async (id: string) =>
      mockStore.has(id) ? JSON.parse(JSON.stringify(mockStore.get(id))) : null,
    put: async (id: string, data: unknown) => {
      mockStore.set(id, JSON.parse(JSON.stringify(data)));
      return true;
    },
    take: async (id: string) => {
      const value = mockStore.get(id) ?? null;
      mockStore.delete(id);
      return value;
    },
    remove: async (id: string) => mockStore.delete(id),
    scan: async (prefix: string) => ({
      cursor: '0',
      ids: [...mockStore.keys()].filter((key) => key.startsWith(prefix)),
    }),
  },
}));

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');
const exchange = async (body: Record<string, string>) => {
  const response = new OAuth2Server.Response();
  await createOAuthServer().token(
    new OAuth2Server.Request({
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(new URLSearchParams(body).toString().length),
      },
      query: {},
      body,
    }),
    response,
  );
  return response.body as {
    access_token: string;
    refresh_token: string;
    scope: string;
  };
};
const approved = async (scopes = 'market:read runtime:read') => {
  const client = await registerOAuthClient({
    client_name: 'Codex or Claude Code',
    redirect_uris: ['http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
  });
  const params = new URLSearchParams({
    client_id: client.client_id,
    response_type: 'code',
    redirect_uri: 'http://127.0.0.1:45678/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'client-state',
    resource: mcpResource(),
    scope: scopes,
  });
  const ticket = await prepareConsent('alice', params);
  const consent = await consumeConsent(ticket);
  expect(await consumeConsent(ticket)).toBeNull();
  const location = new URL(await authorizeConsent(consent!));
  expect(location.searchParams.get('state')).toBe('client-state');
  expect(location.searchParams.get('iss')).toBe('https://tradejs.test');
  return { client, params, code: location.searchParams.get('code')! };
};

beforeEach(() => {
  mockStore.clear();
  mockUser.mockResolvedValue({ passwordHash: 'not-exported' });
  process.env.MCP_PUBLIC_URL = 'https://tradejs.test/mcp';
});

test('public client can consent, exchange S256 code, rotate refresh and revoke the entire connection', async () => {
  const { client, code } = await approved();
  const body = {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: 'http://127.0.0.1:45678/callback',
    code_verifier: verifier,
  };
  const token = await exchange(body);
  const principal = await authenticateMcp(
    new Request(mcpResource(), {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }),
  );
  expect(principal).toMatchObject({
    userName: 'alice',
    clientId: client.client_id,
    scopes: ['market:read', 'runtime:read'],
  });
  await expect(exchange(body)).rejects.toThrow();
  const refreshed = await exchange({
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: token.refresh_token,
  });
  expect(refreshed.access_token).not.toBe(token.access_token);
  await expect(
    exchange({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: token.refresh_token,
    }),
  ).rejects.toThrow();
  expect(await listConnections('bob')).toEqual([]);
  expect(await revokeGrant('bob', principal!.grantId)).toBe(false);
  expect(await revokeGrant('alice', principal!.grantId)).toBe(true);
  expect(
    await authenticateMcp(
      new Request(mcpResource(), {
        headers: { Authorization: `Bearer ${refreshed.access_token}` },
      }),
    ),
  ).toBeNull();
  await expect(
    exchange({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: refreshed.refresh_token,
    }),
  ).rejects.toThrow();
});

test('wrong PKCE verifier and cross-client exchange cannot redeem a code', async () => {
  const { client, code } = await approved();
  const other = await registerOAuthClient({
    redirect_uris: ['http://127.0.0.1/callback'],
  });
  const body = {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: 'http://127.0.0.1:45678/callback',
    code_verifier: 'b'.repeat(43),
  };
  await expect(exchange(body)).rejects.toThrow();
  await expect(
    exchange({ ...body, code_verifier: verifier, client_id: other.client_id }),
  ).rejects.toThrow();
  await expect(
    exchange({ ...body, code_verifier: verifier }),
  ).rejects.toThrow();
  const fresh = await approved();
  expect(
    (
      await exchange({
        ...body,
        client_id: fresh.client.client_id,
        code: fresh.code,
        code_verifier: verifier,
      })
    ).access_token,
  ).toBeTruthy();
});

test('concurrent refresh redemption issues only one replacement', async () => {
  const { client, code } = await approved();
  const token = await exchange({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: 'http://127.0.0.1:45678/callback',
    code_verifier: verifier,
  });
  const request = {
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: token.refresh_token,
  };
  const results = await Promise.allSettled([
    exchange(request),
    exchange(request),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
});

test('requires exact redirect host/path and secure public-client registration', async () => {
  expect(
    redirectMatches(
      'http://127.0.0.1/callback',
      'http://127.0.0.1:1234/callback',
    ),
  ).toBe(true);
  expect(
    redirectMatches(
      'http://127.0.0.1/callback',
      'http://localhost:1234/callback',
    ),
  ).toBe(false);
  expect(
    redirectMatches(
      'https://example.com/callback',
      'https://example.com:1234/callback',
    ),
  ).toBe(false);
  await expect(
    registerOAuthClient({ redirect_uris: ['http://evil.example/callback'] }),
  ).rejects.toThrow();
  await expect(
    registerOAuthClient({
      redirect_uris: ['https://user:password@example.com/callback'],
    }),
  ).rejects.toThrow();
  await expect(
    registerOAuthClient({
      redirect_uris: ['https://example.com/callback'],
      token_endpoint_auth_method: 'client_secret_basic',
    }),
  ).rejects.toThrow();
  const { params } = await approved();
  for (const [key, value] of [
    ['resource', 'https://other.test/mcp'],
    ['scope', 'orders:write'],
    ['code_challenge_method', 'plain'],
    ['redirect_uri', 'https://evil.test/callback'],
  ]) {
    const changed = new URLSearchParams(params);
    changed.set(key, value);
    await expect(prepareConsent('alice', changed)).rejects.toThrow();
  }
});

test('credentials are not stored in plaintext and tokens are bound to this instance', async () => {
  const { client, code } = await approved();
  const token = await exchange({
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: 'http://127.0.0.1:45678/callback',
    code_verifier: verifier,
  });
  const serialized = JSON.stringify([...mockStore]);
  expect(serialized).not.toContain(token.access_token);
  expect(serialized).not.toContain(token.refresh_token);
  expect(serialized).not.toContain(code);
  process.env.MCP_PUBLIC_URL = 'https://another.test/mcp';
  expect(
    await authenticateMcp(
      new Request(mcpResource(), {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }),
    ),
  ).toBeNull();
});
