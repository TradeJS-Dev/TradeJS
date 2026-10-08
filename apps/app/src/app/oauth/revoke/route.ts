import { readMcpBody } from '#app/lib/mcp/http';
import {
  authenticateMcp,
  createOAuthServer,
  oauthResponse,
  revokeGrant,
} from '#app/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = async (request: Request) => {
  const principal = await authenticateMcp(request);
  if (principal) {
    await revokeGrant(principal.userName, principal.grantId);
    return oauthResponse({});
  }
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
  const form = new URLSearchParams(text);
  const model = createOAuthServer().options.model;
  const token =
    (await model.getAccessToken?.(form.get('token') || '')) ||
    ('getRefreshToken' in model
      ? await model.getRefreshToken(form.get('token') || '')
      : null);
  if (token && token.client.id === form.get('client_id'))
    await revokeGrant(token.user.id, token.user.grantId);
  return oauthResponse({});
};
