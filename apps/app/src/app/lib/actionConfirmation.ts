import bcrypt from 'bcryptjs';
import {
  getDataStrict,
  redisKeys,
  twoFactorStorage,
} from '@tradejs/infra/redis';
import { getPasswordHash } from '#app/lib/installation';
import { readTwoFactor, verifyTwoFactor } from '#app/lib/twoFactor';

type Method = 'code' | 'password';

export const actionConfirmationMethod = async (
  user: string,
): Promise<Method> =>
  (await readTwoFactor(user)) === null ? 'password' : 'code';

export const verifyActionConfirmation = async (
  user: string,
  proof: unknown,
  disableTwoFactor = false,
) => {
  const stored = await readTwoFactor(user);
  const method: Method = stored === null ? 'password' : 'code';
  const failure = (error: string, status = 403) => ({
    body: { error, confirmation: { method } },
    status,
  });

  if (
    typeof proof !== 'object' ||
    proof === null ||
    !('method' in proof) ||
    proof.method !== method ||
    !('value' in proof) ||
    typeof proof.value !== 'string' ||
    !proof.value
  ) {
    return failure(
      method === 'code'
        ? 'Enter your authenticator code.'
        : 'Enter your current password.',
    );
  }

  if (stored !== null) {
    const code = proof.value.trim();
    if (
      !/^\d{6}$/.test(code) &&
      (!disableTwoFactor ||
        !/^[A-Fa-f0-9]{5}(?:-?[A-Fa-f0-9]{5}){3}$/.test(code))
    ) {
      return failure('Enter a valid code.');
    }
    const result = await verifyTwoFactor(user, stored, code, disableTwoFactor);
    if (result === 'verified') return null;
    if (result !== 'rate-limited')
      return failure('Invalid or already used code.');
  } else {
    if (await twoFactorStorage.allowAttempt(user, 'password')) {
      const hash = getPasswordHash(await getDataStrict(redisKeys.user(user)));
      if (hash && (await bcrypt.compare(proof.value, hash))) return null;
      return failure('Current password is incorrect.');
    }
  }

  return failure('Too many attempts. Try again in five minutes.', 429);
};

export const requireActionConfirmation = async (
  user: string,
  proof: unknown,
  disableTwoFactor = false,
) => {
  const failure = await verifyActionConfirmation(user, proof, disableTwoFactor);
  return (
    failure &&
    Response.json(failure.body, {
      status: failure.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  );
};
