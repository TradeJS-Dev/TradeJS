import { createHash, randomBytes, randomUUID } from 'node:crypto';
import OAuth2Server from '@node-oauth/oauth2-server';
import { mcpStorage, getDataStrict, redisKeys } from '@tradejs/infra/redis';
import { MCP_SCOPES, type McpPrincipal, type McpScope } from '@tradejs/types';

const TOKEN_TTL = 15 * 60;
const GRANT_TTL = 30 * 24 * 60 * 60;
export const fingerprint = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

export const mcpOrigin = () => {
  const url = new URL(
    String(
      process.env.MCP_PUBLIC_URL ||
        process.env.APP_URL ||
        'http://localhost:3000',
    ),
  );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      ))
  ) {
    throw new Error(
      'MCP_PUBLIC_URL must use HTTPS (HTTP is allowed only on loopback)',
    );
  }
  return url.origin;
};
export const mcpResource = () => `${mcpOrigin()}/mcp`;
export const mcpEnabled = () => process.env.MCP_ENABLED !== 'false';
const storageId = (kind: string, id: string) =>
  `oauth:${fingerprint(mcpOrigin())}:${kind}:${fingerprint(id)}`;

export interface OAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  grants: string[];
}
interface Grant {
  id: string;
  userName: string;
  clientId: string;
  clientName: string;
  scopes: McpScope[];
  resource: string;
  createdAt: number;
  expiresAt: number;
}
export interface ConsentTicket {
  userName: string;
  client: OAuthClient;
  query: Record<string, string>;
  scopes: McpScope[];
}

export const validRedirectUri = (value: string) => {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
};

// RFC 8252 allows a native client to choose its loopback port at login time.
export const redirectMatches = (registered: string, requested: string) => {
  if (!validRedirectUri(requested)) return false;
  const left = new URL(registered);
  const right = new URL(requested);
  if (left.protocol === 'http:' && !left.port) right.port = '';
  return left.href === right.href;
};

export const registerOAuthClient = async (payload: unknown) => {
  if (!payload || typeof payload !== 'object')
    throw new Error('Invalid client metadata');
  const data = payload as Record<string, unknown>;
  const redirects = data.redirect_uris;
  if (
    !Array.isArray(redirects) ||
    !redirects.length ||
    redirects.length > 5 ||
    !redirects.every(
      (uri) =>
        typeof uri === 'string' && uri.length <= 2048 && validRedirectUri(uri),
    ) ||
    (data.token_endpoint_auth_method !== undefined &&
      data.token_endpoint_auth_method !== 'none') ||
    (data.grant_types !== undefined &&
      (!Array.isArray(data.grant_types) ||
        !data.grant_types.every((grant) =>
          ['authorization_code', 'refresh_token'].includes(grant),
        ))) ||
    (data.response_types !== undefined &&
      (!Array.isArray(data.response_types) ||
        data.response_types.length !== 1 ||
        data.response_types[0] !== 'code'))
  ) {
    throw new Error(
      'Public authorization_code clients with HTTPS or loopback redirect URIs are required',
    );
  }
  const client: OAuthClient = {
    id: randomUUID(),
    name:
      typeof data.client_name === 'string'
        ? data.client_name.slice(0, 100)
        : 'MCP client',
    redirectUris: redirects as string[],
    grants: ['authorization_code', 'refresh_token'],
  };
  await mcpStorage.put(storageId('client', client.id), client, 90 * 86400);
  return {
    client_id: client.id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: client.grants,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
};

export const prepareConsent = async (
  userName: string,
  params: URLSearchParams,
) => {
  const query = Object.fromEntries(params);
  if (
    [...new Set(params.keys())].some((key) => params.getAll(key).length !== 1)
  )
    throw new Error('Duplicate OAuth parameter');
  const stored = await mcpStorage.get<OAuthClient>(
    storageId('client', query.client_id || ''),
  );
  if (
    !stored ||
    !query.redirect_uri ||
    !stored.redirectUris.some((uri) => redirectMatches(uri, query.redirect_uri))
  )
    throw new Error('Invalid client or redirect URI');
  if (
    query.response_type !== 'code' ||
    query.code_challenge_method !== 'S256' ||
    !/^[A-Za-z0-9_-]{43}$/.test(query.code_challenge || '') ||
    !query.state ||
    query.state.length > 2048 ||
    (query.resource && query.resource !== mcpResource())
  )
    throw new Error(
      'Authorization code, S256 PKCE, state and the correct resource are required',
    );
  const scopes = (query.scope || MCP_SCOPES.join(' '))
    .split(' ')
    .filter(Boolean);
  if (
    !scopes.length ||
    scopes.some((scope) => !(MCP_SCOPES as readonly string[]).includes(scope))
  )
    throw new Error('Invalid scope');
  const ticket = secret();
  const consent: ConsentTicket = {
    userName,
    client: { ...stored, redirectUris: [query.redirect_uri] },
    query,
    scopes: [...new Set(scopes)] as McpScope[],
  };
  await mcpStorage.put(storageId('consent', ticket), consent, 600);
  return ticket;
};

export const readConsent = (ticket: string) =>
  mcpStorage.get<ConsentTicket>(storageId('consent', ticket));
export const consumeConsent = (ticket: string) =>
  mcpStorage.take<ConsentTicket>(storageId('consent', ticket));

const getGrant = async (id: string) => {
  const grant = await mcpStorage.get<Grant>(storageId('grant', id));
  if (
    !grant ||
    grant.expiresAt <= Date.now() ||
    grant.resource !== mcpResource()
  )
    return null;
  // Account deletion immediately invalidates delegated access.
  return (await getDataStrict(redisKeys.user(grant.userName))) ? grant : null;
};
type StoredToken = Pick<
  OAuth2Server.Token,
  'client' | 'scope' | 'accessTokenExpiresAt' | 'refreshTokenExpiresAt'
> & { user: { id: string; grantId: string; resource: string } };
const restoreToken = (
  stored: StoredToken,
  token: string,
  refresh: boolean,
): OAuth2Server.Token => ({
  ...stored,
  accessToken: refresh ? '' : token,
  ...(refresh ? { refreshToken: token } : {}),
  accessTokenExpiresAt: new Date(stored.accessTokenExpiresAt!),
  ...(stored.refreshTokenExpiresAt
    ? { refreshTokenExpiresAt: new Date(stored.refreshTokenExpiresAt) }
    : {}),
});

export const createOAuthServer = (consent?: ConsentTicket) => {
  const model: OAuth2Server.AuthorizationCodeModel &
    OAuth2Server.RefreshTokenModel = {
    async getClient(id, clientSecret) {
      if (clientSecret) return false;
      return consent?.client.id === id
        ? consent.client
        : await mcpStorage.get<OAuthClient>(storageId('client', id));
    },
    async validateScope(_user, _client, scope) {
      return scope?.length &&
        scope.every((item) => (MCP_SCOPES as readonly string[]).includes(item))
        ? scope
        : false;
    },
    generateAccessToken: async () => secret(),
    generateRefreshToken: async () => secret(),
    generateAuthorizationCode: async () => secret(),
    async saveAuthorizationCode(code, client, user) {
      const value = { ...code, client, user } as OAuth2Server.AuthorizationCode;
      const { authorizationCode, ...stored } = value;
      await mcpStorage.put(storageId('code', authorizationCode), stored, 300);
      return value;
    },
    async getAuthorizationCode(code) {
      const stored = await mcpStorage.get<
        Pick<
          OAuth2Server.AuthorizationCode,
          | 'client'
          | 'user'
          | 'expiresAt'
          | 'redirectUri'
          | 'scope'
          | 'codeChallenge'
          | 'codeChallengeMethod'
        >
      >(storageId('code', code));
      if (!stored || !(await getGrant(stored.user.grantId))) return false;
      return {
        ...stored,
        authorizationCode: code,
        expiresAt: new Date(stored.expiresAt),
      };
    },
    async revokeAuthorizationCode(code) {
      return Boolean(
        await mcpStorage.take(storageId('code', code.authorizationCode)),
      );
    },
    async saveToken(token, client, user) {
      const grant = await getGrant(user.grantId);
      if (!grant || grant.clientId !== client.id)
        throw new Error('Authorization revoked');
      const { accessToken, refreshToken, ...rest } = token;
      const stored = {
        accessTokenExpiresAt: rest.accessTokenExpiresAt,
        refreshTokenExpiresAt: rest.refreshTokenExpiresAt,
        scope: rest.scope,
        client,
        user,
      };
      await mcpStorage.put(storageId('access', accessToken), stored, TOKEN_TTL);
      if (refreshToken)
        await mcpStorage.put(
          storageId('refresh', refreshToken),
          stored,
          Math.max(1, Math.floor((grant.expiresAt - Date.now()) / 1000)),
        );
      return { ...token, client, user };
    },
    async getAccessToken(token) {
      const stored = await mcpStorage.get<StoredToken>(
        storageId('access', token),
      );
      return stored && (await getGrant(stored.user.grantId))
        ? restoreToken(stored, token, false)
        : false;
    },
    async getRefreshToken(token) {
      const stored = await mcpStorage.get<StoredToken>(
        storageId('refresh', token),
      );
      return stored && (await getGrant(stored.user.grantId))
        ? (restoreToken(stored, token, true) as OAuth2Server.RefreshToken)
        : false;
    },
    async revokeToken(token) {
      return Boolean(
        await mcpStorage.take(storageId('refresh', token.refreshToken)),
      );
    },
    async verifyScope(token, scope) {
      return scope.every((item) => token.scope?.includes(item));
    },
  };
  // v5.3 enforces S256 PKCE; its bundled types lag the constructor options.
  const options = {
    model,
    requirePKCE: true,
    enablePlainPKCE: false,
    accessTokenLifetime: TOKEN_TTL,
    refreshTokenLifetime: GRANT_TTL,
    authorizationCodeLifetime: 300,
    requireClientAuthentication: {
      authorization_code: false,
      refresh_token: false,
    },
    alwaysIssueNewRefreshToken: true,
  };
  return new OAuth2Server(options);
};

export const authorizeConsent = async (consent: ConsentTicket) => {
  const grant: Grant = {
    id: randomUUID(),
    userName: consent.userName,
    clientId: consent.client.id,
    clientName: consent.client.name,
    scopes: consent.scopes,
    resource: mcpResource(),
    createdAt: Date.now(),
    expiresAt: Date.now() + GRANT_TTL * 1000,
  };
  await mcpStorage.put(storageId('grant', grant.id), grant, GRANT_TTL);
  await mcpStorage.put(
    `connections:${fingerprint(consent.userName)}:${grant.id}`,
    { ...grant, issuer: mcpOrigin() },
    GRANT_TTL,
  );
  const server = createOAuthServer(consent);
  const response = new OAuth2Server.Response();
  try {
    await server.authorize(
      new OAuth2Server.Request({
        method: 'GET',
        headers: {},
        query: { ...consent.query, scope: consent.scopes.join(' ') },
      }),
      response,
      {
        authenticateHandler: {
          handle: async () => ({
            id: consent.userName,
            grantId: grant.id,
            resource: mcpResource(),
          }),
        },
      },
    );
    const location = new URL(response.get('location'));
    location.searchParams.set('iss', mcpOrigin());
    return location.href;
  } catch (error) {
    await revokeGrant(consent.userName, grant.id);
    throw error;
  }
};

export const authenticateMcp = async (
  request: Request,
): Promise<McpPrincipal | null> => {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(
    request.headers.get('authorization') || '',
  );
  if (!match) return null;
  const server = createOAuthServer();
  const token = await server.options.model.getAccessToken!(match[1]);
  if (
    !token ||
    !token.accessTokenExpiresAt ||
    token.accessTokenExpiresAt.getTime() <= Date.now() ||
    token.user.resource !== mcpResource()
  )
    return null;
  return {
    userName: token.user.id,
    clientId: token.client.id,
    grantId: token.user.grantId,
    scopes: token.scope as McpScope[],
  };
};

export const listConnections = async (userName: string) => {
  const grants: Grant[] = [];
  let cursor = '0';
  do {
    const page = await mcpStorage.scan(
      `connections:${fingerprint(userName)}:`,
      cursor,
    );
    cursor = page.cursor;
    for (const id of page.ids) {
      const grant = await mcpStorage.get<Grant & { issuer: string }>(id);
      if (grant?.issuer === mcpOrigin() && (await getGrant(grant.id)))
        grants.push(grant);
    }
  } while (cursor !== '0');
  return grants.sort((a, b) => b.createdAt - a.createdAt);
};
export const revokeGrant = async (userName: string, grantId: string) => {
  const grant = await mcpStorage.get<Grant>(storageId('grant', grantId));
  if (!grant || grant.userName !== userName) return false;
  await mcpStorage.remove(storageId('grant', grantId));
  await mcpStorage.remove(`connections:${fingerprint(userName)}:${grantId}`);
  return true;
};

export const oauthMetadata = () => ({
  issuer: mcpOrigin(),
  authorization_endpoint: `${mcpOrigin()}/oauth/authorize`,
  token_endpoint: `${mcpOrigin()}/oauth/token`,
  registration_endpoint: `${mcpOrigin()}/oauth/register`,
  revocation_endpoint: `${mcpOrigin()}/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
  authorization_response_iss_parameter_supported: true,
  scopes_supported: MCP_SCOPES,
});

export const protectedResourceMetadata = () => ({
  resource: mcpResource(),
  authorization_servers: [mcpOrigin()],
  scopes_supported: MCP_SCOPES,
  bearer_methods_supported: ['header'],
});

export const oauthResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...headers },
  });
export const requireSameOrigin = (request: Request) =>
  request.headers.get('origin') === mcpOrigin();
