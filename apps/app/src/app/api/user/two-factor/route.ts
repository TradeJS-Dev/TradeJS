import { getCurrentUserName } from '#app/lib/currentUser';
import { requireActionConfirmation } from '#app/lib/actionConfirmation';
import {
  beginTwoFactorSetup,
  enableTwoFactor,
  readTwoFactor,
} from '#app/lib/twoFactor';

const json = (body: object, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const GET = async () => {
  const user = await getCurrentUserName();
  if (!user) return json({ error: 'Unauthorized' }, 401);
  return json({ enabled: (await readTwoFactor(user)) !== null });
};

export const POST = async (request: Request) => {
  const user = await getCurrentUserName();
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (
    request.headers.get('content-type')?.split(';')[0] !== 'application/json'
  ) {
    return json({ error: 'Expected JSON' }, 415);
  }

  const data: unknown = await request.json().catch(() => null);
  if (typeof data !== 'object' || data === null || !('action' in data)) {
    return json({ error: 'Invalid request' }, 400);
  }
  const { action } = data;
  const stored = await readTwoFactor(user);
  if (action === 'start') {
    return stored === null
      ? json(beginTwoFactorSetup(user))
      : json({ error: 'Two-factor authentication is already enabled' }, 409);
  }
  const proof = 'confirmation' in data ? data.confirmation : undefined;
  if (action === 'disable') {
    const failure = await requireActionConfirmation(user, proof, true);
    return failure ?? json({ enabled: false });
  }
  if (
    action !== 'enable' ||
    !('code' in data) ||
    typeof data.code !== 'string' ||
    !('setup' in data) ||
    typeof data.setup !== 'string' ||
    data.setup.length > 256
  ) {
    return json({ error: 'Invalid request' }, 400);
  }
  if (stored !== null) {
    return json({ error: 'Two-factor authentication is already enabled' }, 409);
  }
  const failure = await requireActionConfirmation(user, proof);
  if (failure) return failure;

  const result = await enableTwoFactor(user, data.setup, data.code.trim());
  switch (result.status) {
    case 'enabled':
      return json({ enabled: true, recoveryCodes: result.recoveryCodes });
    case 'invalid-setup':
      return json({ error: 'Setup has expired. Start setup again.' }, 400);
    case 'invalid-code':
      return json({ error: 'Invalid authenticator code' }, 400);
    case 'rate-limited':
      return json(
        { error: 'Too many attempts. Try again in five minutes.' },
        429,
      );
    case 'already-enabled':
      return json(
        { error: 'Two-factor authentication is already enabled' },
        409,
      );
  }
};
