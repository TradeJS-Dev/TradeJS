import type { MarketUniverse, TradingAccountRef } from '@tradejs/types';
import { delKey, getData, getKeys, redisKeys, setData } from './redis';

const normalizeId = (value: string, label: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
};

const isTradingAccount = (value: unknown): value is TradingAccountRef =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as TradingAccountRef).id === 'string' &&
      typeof (value as TradingAccountRef).provider === 'string',
  );

const withProviderUniverses = (
  account: TradingAccountRef,
): TradingAccountRef =>
  account.provider.toLowerCase() === 'bybit'
    ? { ...account, universes: ['crypto', 'tradfi'] }
    : account;

export const listTradingAccounts = async (
  userName: string,
): Promise<TradingAccountRef[]> => {
  if (typeof redisKeys.tradingAccounts !== 'function') return [];
  const keys = await getKeys(redisKeys.tradingAccounts(userName));
  const values = await Promise.all(keys.map((key) => getData(key, null)));
  return values
    .filter(isTradingAccount)
    .map(withProviderUniverses)
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const getTradingAccount = async (
  userName: string,
  accountId: string,
): Promise<TradingAccountRef | null> => {
  const normalizedId = normalizeId(accountId, 'Account id');
  const value = await getData(
    redisKeys.tradingAccount(userName, normalizedId),
    null,
  );
  return isTradingAccount(value) ? withProviderUniverses(value) : null;
};

export const saveTradingAccount = async (
  userName: string,
  account: TradingAccountRef,
): Promise<TradingAccountRef> => {
  const normalized = withProviderUniverses({
    ...account,
    id: normalizeId(account.id, 'Account id'),
    label: account.label.trim(),
    provider: account.provider.trim().toLowerCase(),
    universes: [...new Set(account.universes)],
  });
  if (normalized.isDefault) {
    const previousDefaults = (await listTradingAccounts(userName)).filter(
      (candidate) =>
        candidate.provider === normalized.provider &&
        candidate.id !== normalized.id &&
        candidate.isDefault &&
        candidate.universes.some((universe) =>
          normalized.universes.includes(universe),
        ),
    );
    await Promise.all(
      previousDefaults.map((candidate) =>
        setData(
          redisKeys.tradingAccount(userName, candidate.id),
          { ...candidate, isDefault: false },
          { expire: 0 },
        ),
      ),
    );
  }
  await setData(redisKeys.tradingAccount(userName, normalized.id), normalized, {
    expire: 0,
  });
  return normalized;
};

export const deleteTradingAccount = async (
  userName: string,
  accountId: string,
) =>
  delKey(
    redisKeys.tradingAccount(userName, normalizeId(accountId, 'Account id')),
  );

export const resolveTradingAccount = async ({
  userName,
  accountId,
  provider,
  universe,
}: {
  userName: string;
  accountId?: string;
  provider: string;
  universe?: MarketUniverse;
}): Promise<TradingAccountRef | null> => {
  if (accountId) {
    const account = await getTradingAccount(userName, accountId);
    if (!account) {
      throw new Error(`Trading account not found: ${accountId}`);
    }
    if (account.provider !== provider.toLowerCase()) {
      throw new Error(
        `Trading account ${accountId} belongs to ${account.provider}, not ${provider}`,
      );
    }
    if (!account.enabled) {
      throw new Error(`Trading account is disabled: ${accountId}`);
    }
    if (universe && !account.universes.includes(universe)) {
      throw new Error(
        `Trading account ${accountId} does not support universe ${universe}`,
      );
    }
    return account;
  }

  const accounts = (await listTradingAccounts(userName)).filter(
    (account) =>
      account.enabled &&
      account.provider === provider.toLowerCase() &&
      (!universe || account.universes.includes(universe)),
  );
  const selected =
    accounts.find((account) => account.isDefault) ??
    (accounts.length === 1 ? accounts[0] : null);
  if (selected) return selected;

  if (provider.toLowerCase() !== 'bybit' || accounts.length > 1) {
    return null;
  }
  const legacy = (await getData(redisKeys.user(userName))) as Record<
    string,
    unknown
  > | null;
  const legacyApiKey = String(legacy?.BYBIT_API_KEY ?? '').trim();
  const legacyApiSecret = String(legacy?.BYBIT_API_SECRET ?? '').trim();
  if (!legacyApiKey || !legacyApiSecret) {
    return null;
  }

  return {
    id: 'bybit-default',
    label: 'Bybit Default',
    provider: 'bybit',
    enabled: true,
    isDefault: true,
    universes: ['crypto', 'tradfi'],
    environment: 'mainnet',
    apiKey: legacyApiKey,
    apiSecret: legacyApiSecret,
  };
};
