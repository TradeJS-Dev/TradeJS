import { readMcpBody } from '#app/lib/mcp/http';
import OAuth2Server from '@node-oauth/oauth2-server';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  createOAuthServer,
  mcpEnabled,
  mcpResource,
  oauthResponse,
} from '#app/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: Request) => {
  if (!mcpEnabled())
    return oauthResponse({ error: 'temporarily_unavailable' }, 503);
  if (!(await mcpStorage.rateLimit('token', 600, 60)))
    return oauthResponse({ error: 'temporarily_unavailable' }, 429);
  if (
    !request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
  )
    return oauthResponse({ error: 'invalid_request' }, 400);
  let text: string;
  try {
    text = await readMcpBody(request, 8192);
  } catch {
    return oauthResponse({ error: 'invalid_request' }, 400);
  }
  if (text.length > 8192)
    return oauthResponse({ error: 'invalid_request' }, 400);
  const params = new URLSearchParams(text);
  if (
    [...new Set(params.keys())].some((key) => params.getAll(key).length > 1) ||
    (params.has('resource') && params.get('resource') !== mcpResource()) ||
    !['authorization_code', 'refresh_token'].includes(
      params.get('grant_type') || '',
    )
  )
    return oauthResponse({ error: 'invalid_request' }, 400);
  const response = new OAuth2Server.Response();
  try {
    await createOAuthServer().token(
      new OAuth2Server.Request({
        method: 'POST',
        headers: {
          ...Object.fromEntries(request.headers),
          'content-length': String(Buffer.byteLength(text)),
        },
        query: {},
        body: Object.fromEntries(params),
      }),
      response,
    );
    return oauthResponse(
      response.body,
      response.status || 200,
      response.headers,
    );
  } catch (error) {
    if (error instanceof OAuth2Server.OAuthError)
      return oauthResponse(
        { error: error.name, error_description: error.message },
        error.code || 400,
      );
    return oauthResponse({ error: 'server_error' }, 503);
  }
};
