import { readMcpBody } from '#app/lib/mcp/http';
import { getCurrentUserName } from '#app/lib/currentUser';
import { verifyActionConfirmation } from '#app/lib/actionConfirmation';
import {
  authorizeConsent,
  consumeConsent,
  mcpEnabled,
  mcpOrigin,
  oauthResponse,
  prepareConsent,
  readConsent,
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
  const pending = await readConsent(ticket);
  if (!pending || pending.userName !== userName)
    return oauthResponse({ error: 'invalid_request' }, 400);

  const allowed = form.get('decision') === 'allow';
  const requestedScopes = new Set(form.getAll('scope'));
  const selected = pending.scopes.filter((scope) => requestedScopes.has(scope));
  if (allowed) {
    if (!selected.length || selected.length !== requestedScopes.size)
      return oauthResponse({ error: 'invalid_scope' }, 400);
    const failure = await verifyActionConfirmation(userName, {
      method: form.get('confirmationMethod'),
      value: form.get('confirmation'),
    });
    if (failure) {
      const retry = new URL('/routes/mcp/consent', mcpOrigin());
      retry.searchParams.set('ticket', ticket);
      retry.searchParams.set(
        'confirmation',
        failure.status === 429 ? 'limited' : 'retry',
      );
      for (const scope of selected) retry.searchParams.append('scope', scope);
      return Response.redirect(retry, 303);
    }
  }

  const consent = await consumeConsent(ticket);
  if (!consent || consent.userName !== userName)
    return oauthResponse({ error: 'invalid_request' }, 400);
  if (!allowed) {
    const location = new URL(consent.query.redirect_uri);
    location.searchParams.set('error', 'access_denied');
    location.searchParams.set('state', consent.query.state);
    location.searchParams.set('iss', mcpOrigin());
    return Response.redirect(location, 303);
  }
  consent.scopes = selected;
  consent.query.scope = selected.join(' ');
  return Response.redirect(await authorizeConsent(consent), 303);
};
