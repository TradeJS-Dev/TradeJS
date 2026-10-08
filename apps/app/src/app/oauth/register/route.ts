import { readMcpBody } from '#app/lib/mcp/http';
import { mcpStorage } from '@tradejs/infra/redis';
import {
  fingerprint,
  mcpEnabled,
  oauthResponse,
  registerOAuthClient,
} from '#app/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: Request) => {
  if (!mcpEnabled())
    return oauthResponse({ error: 'temporarily_unavailable' }, 503);
  // Global cap also protects deployments without a trusted forwarding proxy.
  if (!(await mcpStorage.rateLimit('register', 100, 3600)))
    return oauthResponse({ error: 'temporarily_unavailable' }, 429);
  try {
    const text = await readMcpBody(request, 8192);
    if (
      !(await mcpStorage.rateLimit(
        `register:${fingerprint(request.headers.get('x-forwarded-for') || 'local')}`,
        20,
        3600,
      ))
    )
      return oauthResponse({ error: 'temporarily_unavailable' }, 429);
    return oauthResponse(await registerOAuthClient(JSON.parse(text)), 201);
  } catch {
    return oauthResponse({ error: 'invalid_client_metadata' }, 400);
  }
};
