/** @jest-environment node */

import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { CredentialsConfig } from 'next-auth/providers/credentials';

const mockGetData = jest.fn();
const mockGetCurrentUserName = jest.fn();
const mockAllowAttempt = jest.fn();
const mockState = new Map<string, string>();

jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn(() => ({})),
  CredentialsSignin: class extends Error {},
}));
jest.mock('next-auth/providers/credentials', () => ({
  __esModule: true,
  default: (config: unknown) => config,
}));
jest.mock('#app/lib/currentUser', () => ({
  getCurrentUserName: () => mockGetCurrentUserName(),
}));
jest.mock('@tradejs/infra/redis', () => ({
  redisKeys: { user: (user: string) => 'users:index:' + user },
  getDataStrict: (...args: unknown[]) => mockGetData(...args),
  twoFactorStorage: {
    read: async (user: string) => mockState.get(user) ?? null,
    replace: async (
      user: string,
      previous: string | null,
      next: string | null,
    ) => {
      if ((mockState.get(user) ?? null) !== previous) return false;
      if (next === null) mockState.delete(user);
      else mockState.set(user, next);
      return true;
    },
    allowAttempt: (...args: unknown[]) => mockAllowAttempt(...args),
  },
}));

import '#app/auth';
import { requireActionConfirmation } from '#app/lib/actionConfirmation';
import { matchingTotpCounter } from '#app/lib/twoFactor';
import { GET, POST } from '../route';

const username = 'root';
const password = 'fixture-password';
const epoch = 1_800_000_000_000;
const request = (data: object) =>
  new Request('http://localhost/api/user/two-factor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

const config: CredentialsConfig =
  jest.requireMock('next-auth').default.mock.calls[0][0].providers[0];
const signIn = (code: string | undefined, suppliedPassword = password) =>
  config.authorize({ username, password: suppliedPassword, code }, request({}));

const authenticatorCode = (key: string, now: number) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...key]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0'))
    .join('');
  const secret = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)),
  );
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(now / 30_000));
  const hash = createHmac('sha1', secret).update(message).digest();
  const offset = hash[19] % 16;
  return (hash.readUInt32BE(offset) & 0x7fffffff)
    .toString()
    .slice(-6)
    .padStart(6, '0');
};

const setUp = async () => {
  const started = await POST(request({ action: 'start' }));
  expect(started.headers.get('cache-control')).toBe('no-store');
  const { key, uri, setup } = await started.json();
  const provisioning = new URL(uri);
  expect(provisioning.protocol).toBe('otpauth:');
  expect(provisioning.hostname).toBe('totp');
  expect(provisioning.pathname).toBe('/TradeJS:root');
  expect(Object.fromEntries(provisioning.searchParams)).toEqual({
    secret: key,
    issuer: 'TradeJS',
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  const code = authenticatorCode(key, epoch);
  return {
    key,
    setup,
    code,
    payload: {
      action: 'enable',
      confirmation: { method: 'password', value: password },
      setup,
      code,
    },
  };
};

const originalSecret = process.env.AUTH_SECRET;
beforeEach(() => {
  process.env.AUTH_SECRET = 'fixture-auth-secret';
  jest.spyOn(Date, 'now').mockReturnValue(epoch);
  mockState.clear();
  mockGetData.mockResolvedValue({ passwordHash: bcrypt.hashSync(password, 4) });
  mockGetCurrentUserName.mockResolvedValue(username);
  mockAllowAttempt.mockResolvedValue(true);
});
afterEach(() => {
  jest.restoreAllMocks();
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

it('matches the six-digit form of the RFC 6238 SHA-1 vector and rejects reuse', () => {
  const key = Buffer.from('12345678901234567890');
  expect(matchingTotpCounter(key, '287082', 59_000, -1)).toBe(1);
  expect(matchingTotpCounter(key, '287082', 59_000, 1)).toBeNull();
});

it('requires a real second factor only after setup and atomically consumes codes', async () => {
  await expect(signIn(undefined)).resolves.toEqual({
    id: username,
    name: username,
  });

  const { key, code, payload } = await setUp();
  expect((await POST(request({ ...payload, code: '12345' }))).status).toBe(400);
  await expect((await GET()).json()).resolves.toEqual({ enabled: false });

  const enabled = await POST(request(payload));
  expect(enabled.status).toBe(200);
  const { recoveryCodes } = await enabled.json();
  expect(recoveryCodes).toHaveLength(8);
  expect(mockState.get(username)).not.toContain(key);
  expect(mockState.get(username)).not.toContain(recoveryCodes[0]);
  await expect((await GET()).json()).resolves.toEqual({ enabled: true });

  await expect(signIn(undefined, 'wrong-password')).resolves.toBeNull();
  await expect(signIn(undefined)).rejects.toMatchObject({
    code: 'two_factor_required',
  });
  await expect(signIn(code)).rejects.toMatchObject({
    code: 'two_factor_invalid',
  });

  jest.mocked(Date.now).mockReturnValue(epoch + 30_000);
  const nextCode = authenticatorCode(key, epoch + 30_000);
  const results = await Promise.allSettled([
    signIn(nextCode),
    signIn(nextCode),
  ]);
  expect(results.map(({ status }) => status).sort()).toEqual([
    'fulfilled',
    'rejected',
  ]);

  await expect(signIn(recoveryCodes[0])).resolves.toEqual({
    id: username,
    name: username,
  });
  await expect(signIn(recoveryCodes[0])).rejects.toMatchObject({
    code: 'two_factor_invalid',
  });

  const disabled = await POST(
    request({
      action: 'disable',
      confirmation: { method: 'code', value: recoveryCodes[1] },
    }),
  );
  await expect(disabled.json()).resolves.toEqual({ enabled: false });
  await expect(signIn(undefined)).resolves.toEqual({
    id: username,
    name: username,
  });
});

it('rejects unauthorized, wrong-password, other-user and expired setup requests', async () => {
  mockGetCurrentUserName.mockResolvedValueOnce(null);
  expect((await POST(request({ action: 'start' }))).status).toBe(401);

  const { payload } = await setUp();
  expect(
    (
      await POST(
        request({
          ...payload,
          confirmation: { method: 'password', value: 'wrong-password' },
        }),
      )
    ).status,
  ).toBe(403);
  mockGetCurrentUserName.mockResolvedValueOnce('other-user');
  expect((await POST(request(payload))).status).toBe(400);

  jest.mocked(Date.now).mockReturnValue(epoch + 600_000);
  expect((await POST(request(payload))).status).toBe(400);
  expect(mockState.size).toBe(0);
});

it('blocks verification when the shared attempt limit is reached', async () => {
  const { payload } = await setUp();
  expect((await POST(request(payload))).status).toBe(200);
  mockAllowAttempt.mockResolvedValue(false);
  await expect(signIn(payload.code)).rejects.toMatchObject({
    code: 'two_factor_rate_limited',
  });
});

it('confirms with the current password only while 2FA is disabled', async () => {
  const proof = { method: 'password', value: password };
  const required = await requireActionConfirmation(username, undefined);
  expect(required?.status).toBe(403);
  await expect(required?.json()).resolves.toMatchObject({
    confirmation: { method: 'password' },
  });
  expect(
    (await requireActionConfirmation(username, { ...proof, value: 'wrong' }))
      ?.status,
  ).toBe(403);
  await expect(requireActionConfirmation(username, proof)).resolves.toBeNull();
  expect(mockAllowAttempt).toHaveBeenCalledWith(username, 'password');

  const { key, payload } = await setUp();
  const enabled = await POST(request(payload));
  expect(enabled.status).toBe(200);
  const { recoveryCodes } = await enabled.json();

  const requiresCode = await requireActionConfirmation(username, proof);
  expect(requiresCode?.status).toBe(403);
  await expect(requiresCode?.json()).resolves.toMatchObject({
    confirmation: { method: 'code' },
  });
  const cannotDisableWithPassword = await POST(
    request({ action: 'disable', confirmation: proof }),
  );
  expect(cannotDisableWithPassword.status).toBe(403);
  await expect((await GET()).json()).resolves.toEqual({ enabled: true });
  expect(
    (
      await requireActionConfirmation(username, {
        method: 'code',
        value: recoveryCodes[0],
      })
    )?.status,
  ).toBe(403);

  jest.mocked(Date.now).mockReturnValue(epoch + 30_000);
  const code = {
    method: 'code',
    value: authenticatorCode(key, epoch + 30_000),
  };
  await expect(requireActionConfirmation(username, code)).resolves.toBeNull();
  expect((await requireActionConfirmation(username, code))?.status).toBe(403);

  const wrong = { method: 'code', value: 'invalid' };
  expect(
    (await POST(request({ action: 'disable', confirmation: wrong }))).status,
  ).toBe(403);
  await expect((await GET()).json()).resolves.toEqual({ enabled: true });
});
