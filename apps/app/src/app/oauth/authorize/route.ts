import { readMcpBody } from '#app/lib/mcp/http';
import { getCurrentUserName } from '#app/lib/currentUser';
import {
  authorizeConsent,
  consumeConsent,
  mcpEnabled,
  mcpOrigin,
  oauthResponse,
  prepareConsent,
  requireSameOrigin,
} from '#app/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = async (request: Request) => {
  if (!mcpEnabled())
    return oauthResponse({ error: 'temporarily_unavailable' }, 503);
  const userName = await getCurrentUserName();
  if (!userName) {
    const signin = new URL('/routes/signin', mcpOrigin());
    signin.searchParams.set(
      'callbackUrl',
      `${mcpOrigin()}/oauth/authorize${new URL(request.url).search}`,
    );
    return Response.redirect(signin, 303);
  }
  try {
    const ticket = await prepareConsent(
      userName,
      new URL(request.url).searchParams,
    );
    return Response.redirect(
      `${mcpOrigin()}/routes/mcp/consent?ticket=${ticket}`,
      303,
    );
  } catch {
    return oauthResponse(
      {
        error: 'invalid_request',
        error_description: 'Invalid OAuth authorization request',
      },
      400,
    );
  }
};

export const POST = async (request: Request) => {
  if (!mcpEnabled())
    return oauthResponse({ error: 'temporarily_unavailable' }, 503);
  if (!requireSameOrigin(request))
    return oauthResponse({ error: 'access_denied' }, 403);
  const userName = await getCurrentUserName();
  if (!userName) return oauthResponse({ error: 'access_denied' }, 401);
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await readMcpBody(request, 8192));
  } catch {
    return oauthResponse({ error: 'invalid_request' }, 400);
  }
  const ticket = String(form.get('ticket') || '');
  const consent = await consumeConsent(ticket);
  if (!consent || consent.userName !== userName)
    return oauthResponse({ error: 'invalid_request' }, 400);
  if (form.get('decision') !== 'allow') {
    const location = new URL(consent.query.redirect_uri);
    location.searchParams.set('error', 'access_denied');
    location.searchParams.set('state', consent.query.state);
    location.searchParams.set('iss', mcpOrigin());
    return Response.redirect(location, 303);
  }
  const selected = form.getAll('scope');
  if (
    !selected.length ||
    selected.some(
      (scope) =>
        !consent.scopes.includes(scope as (typeof consent.scopes)[number]),
    )
  )
    return oauthResponse({ error: 'invalid_scope' }, 400);
  consent.scopes = consent.scopes.filter((scope) => selected.includes(scope));
  consent.query.scope = consent.scopes.join(' ');
  return Response.redirect(await authorizeConsent(consent), 303);
};
