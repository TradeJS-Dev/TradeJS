import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { twoFactorStorage } from '@tradejs/infra/redis';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_MS = 30_000;
const SETUP_TTL_MS = 10 * 60_000;

type State = {
  secret: string;
  lastCounter: number;
  recoveryHashes: string[];
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const encryptionKey = () => {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Missing authentication secret for 2FA');
  return createHmac('sha256', secret).update('tradejs:two-factor:v1').digest();
};

const encryptionContext = (user: string, purpose: 'setup' | 'active') =>
  Buffer.from(JSON.stringify([user, purpose]));

const seal = (user: string, purpose: 'setup' | 'active', value: Buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(encryptionContext(user, purpose));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    'base64url',
  );
};

const unseal = (user: string, purpose: 'setup' | 'active', value: string) => {
  const packet = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    packet.subarray(0, 12),
  );
  decipher.setAAD(encryptionContext(user, purpose));
  decipher.setAuthTag(packet.subarray(12, 28));
  return Buffer.concat([
    decipher.update(packet.subarray(28)),
    decipher.final(),
  ]);
};

const toBase32 = (secret: Buffer) => {
  let result = '';
  let bits = 0;
  let buffer = 0;
  for (const byte of secret) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(buffer >>> bits) & 31];
    }
  }
  // The generated 20-byte secret always occupies exactly 32 Base32 digits.
  return result;
};

const codeAt = (secret: Buffer, counter: number) => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    '0',
  );
};

export const matchingTotpCounter = (
  secret: Buffer,
  code: string,
  now: number,
  lastCounter: number,
) => {
  if (!/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code);
  const current = Math.floor(now / PERIOD_MS);
  for (const counter of [current, current - 1, current + 1]) {
    if (
      counter >= 0 &&
      counter > lastCounter &&
      timingSafeEqual(supplied, Buffer.from(codeAt(secret, counter)))
    ) {
      return counter;
    }
  }
  return null;
};

export const beginTwoFactorSetup = (user: string) => {
  const secret = randomBytes(20);
  const expires = Buffer.alloc(8);
  expires.writeDoubleBE(Date.now() + SETUP_TTL_MS);
  const key = toBase32(secret);
  const issuer = 'TradeJS';
  const account = encodeURIComponent(user.replaceAll(':', '-'));
  const parameters = new URLSearchParams({
    secret: key,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: String(PERIOD_MS / 1000),
  });
  return {
    key,
    uri: `otpauth://totp/${issuer}:${account}?${parameters}`,
    setup: seal(user, 'setup', Buffer.concat([expires, secret])),
  };
};

export const enableTwoFactor = async (
  user: string,
  setup: string,
  code: string,
) => {
  const now = Date.now();
  let packet: Buffer;
  try {
    packet = unseal(user, 'setup', setup);
  } catch {
    return { status: 'invalid-setup' } as const;
  }
  if (packet.length !== 28 || packet.readDoubleBE() <= now) {
    return { status: 'invalid-setup' } as const;
  }
  if (!(await twoFactorStorage.allowAttempt(user))) {
    return { status: 'rate-limited' } as const;
  }
  const secret = packet.subarray(8);
  const lastCounter = matchingTotpCounter(secret, code, now, -1);
  if (lastCounter === null) return { status: 'invalid-code' } as const;

  const recoveryCodes = Array.from({ length: 8 }, () => {
    const value = randomBytes(10).toString('hex').toUpperCase();
    return [
      value.slice(0, 5),
      value.slice(5, 10),
      value.slice(10, 15),
      value.slice(15),
    ].join('-');
  });
  const state: State = {
    secret: seal(user, 'active', secret),
    lastCounter,
    recoveryHashes: recoveryCodes.map((value) =>
      digest(value.replaceAll('-', '')),
    ),
  };
  const enabled = await twoFactorStorage.replace(
    user,
    null,
    JSON.stringify(state),
  );
  return enabled
    ? ({ status: 'enabled', recoveryCodes } as const)
    : ({ status: 'already-enabled' } as const);
};

export const readTwoFactor = (user: string) => twoFactorStorage.read(user);

export const verifyTwoFactor = async (
  user: string,
  stored: string,
  code: string,
  disable = false,
) => {
  if (!(await twoFactorStorage.allowAttempt(user))) return 'rate-limited';

  const state = JSON.parse(stored) as State;
  const normalized = code.trim().replaceAll('-', '').toUpperCase();
  const recoveryHash = /^[A-F0-9]{20}$/.test(normalized)
    ? digest(normalized)
    : null;
  if (recoveryHash && state.recoveryHashes.includes(recoveryHash)) {
    state.recoveryHashes = state.recoveryHashes.filter(
      (hash) => hash !== recoveryHash,
    );
  } else {
    const secret = unseal(user, 'active', state.secret);
    const counter = matchingTotpCounter(
      secret,
      code.trim(),
      Date.now(),
      state.lastCounter,
    );
    if (counter === null) return 'invalid-code';
    state.lastCounter = counter;
  }
  const changed = await twoFactorStorage.replace(
    user,
    stored,
    disable ? null : JSON.stringify(state),
  );
  return changed ? 'verified' : 'invalid-code';
};
