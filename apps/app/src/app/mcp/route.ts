import { readMcpBody } from '#app/lib/mcp/http';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  authenticateMcp,
  fingerprint,
  mcpEnabled,
  mcpOrigin,
  mcpResource,
  oauthResponse,
} from '#app/lib/mcp/oauth';
import { createTradejsMcpServer } from '#app/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: Request) => {
  if (!mcpEnabled()) return oauthResponse({ error: 'MCP disabled' }, 503);
  const origin = request.headers.get('origin');
  if (origin && origin !== mcpOrigin())
    return oauthResponse({ error: 'Invalid origin' }, 403);
  try {
    const principal = await authenticateMcp(request);
    if (!principal)
      return oauthResponse({ error: 'Unauthorized' }, 401, {
        'WWW-Authenticate': `Bearer resource_metadata="${mcpOrigin()}/.well-known/oauth-protected-resource/mcp"`,
      });
    if (
      !(await mcpStorage.rateLimit(
        `requests:${fingerprint(`${principal.userName}:${principal.clientId}`)}`,
        120,
        60,
      ))
    )
      return oauthResponse({ error: 'Rate limit exceeded' }, 429, {
        'Retry-After': '60',
      });
    const body = await readMcpBody(request, 65536);
    if (Buffer.byteLength(body) > 65536)
      return oauthResponse({ error: 'Request too large' }, 413);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createTradejsMcpServer(principal);
    await server.connect(transport);
    try {
      const forwarded = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body,
      });
      return await transport.handleRequest(forwarded, {
        authInfo: {
          token: '',
          clientId: principal.clientId,
          scopes: principal.scopes,
          resource: new URL(mcpResource()),
        },
      });
    } finally {
      await server.close();
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Request too large')
      return oauthResponse({ error: 'Request too large' }, 413);
    return oauthResponse({ error: 'MCP unavailable' }, 503);
  }
};

export const GET = () =>
  oauthResponse({ error: 'Use POST for Streamable HTTP requests' }, 405, {
    Allow: 'POST',
  });
export const DELETE = GET;
