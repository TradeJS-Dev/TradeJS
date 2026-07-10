import type {
  MarketUniverse,
  RuntimeDeployment,
  RuntimeDeploymentHeartbeat,
  TradingAccountRef,
} from '@tradejs/types';
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

const isRuntimeDeployment = (value: unknown): value is RuntimeDeployment =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as RuntimeDeployment).id === 'string' &&
      typeof (value as RuntimeDeployment).accountId === 'string',
  );

export const listTradingAccounts = async (
  userName: string,
): Promise<TradingAccountRef[]> => {
  if (typeof redisKeys.tradingAccounts !== 'function') return [];
  const keys = await getKeys(redisKeys.tradingAccounts(userName));
  const values = await Promise.all(keys.map((key) => getData(key, null)));
  return values
    .filter(isTradingAccount)
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
  return isTradingAccount(value) ? value : null;
};

export const saveTradingAccount = async (
  userName: string,
  account: TradingAccountRef,
): Promise<TradingAccountRef> => {
  const normalized: TradingAccountRef = {
    ...account,
    id: normalizeId(account.id, 'Account id'),
    label: account.label.trim(),
    provider: account.provider.trim().toLowerCase(),
    universes: [...new Set(account.universes)],
  };
  if (normalized.isDefault) {
    const previousDefaults = (await listTradingAccounts(userName)).filter(
      (candidate) =>
        candidate.provider === normalized.provider &&
        candidate.id !== normalized.id &&
        candidate.isDefault,
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
    (account) => account.enabled && account.provider === provider.toLowerCase(),
  );
  const selected =
    accounts.find((account) => account.isDefault) ??
    (accounts.length === 1 ? accounts[0] : null);
  if (selected) {
    if (universe && !selected.universes.includes(universe)) {
      throw new Error(
        `Trading account ${selected.id} does not support universe ${universe}`,
      );
    }
    return selected;
  }

  if (provider.toLowerCase() !== 'bybit' || accounts.length > 1) {
    return null;
  }
  if (universe === 'tradfi') {
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
    universes: ['crypto'],
    environment: 'mainnet',
    apiKey: legacyApiKey,
    apiSecret: legacyApiSecret,
  };
};

export const listRuntimeDeployments = async (
  userName: string,
): Promise<RuntimeDeployment[]> => {
  const keys = await getKeys(redisKeys.runtimeDeployments(userName));
  const values = await Promise.all(keys.map((key) => getData(key, null)));
  return values
    .filter(isRuntimeDeployment)
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const getRuntimeDeployment = async (
  userName: string,
  deploymentId: string,
): Promise<RuntimeDeployment | null> => {
  const normalizedId = normalizeId(deploymentId, 'Deployment id');
  const value = await getData(
    redisKeys.runtimeDeployment(userName, normalizedId),
    null,
  );
  return isRuntimeDeployment(value) ? value : null;
};

export const saveRuntimeDeployment = async (
  userName: string,
  deployment: RuntimeDeployment,
): Promise<RuntimeDeployment> => {
  const normalized: RuntimeDeployment = {
    ...deployment,
    id: normalizeId(deployment.id, 'Deployment id'),
    label: deployment.label.trim(),
    provider: deployment.provider.trim().toLowerCase(),
    accountId: normalizeId(deployment.accountId, 'Account id'),
  };
  await setData(
    redisKeys.runtimeDeployment(userName, normalized.id),
    normalized,
    { expire: 0 },
  );
  return normalized;
};

export const deleteRuntimeDeployment = async (
  userName: string,
  deploymentId: string,
) => {
  const normalizedId = normalizeId(deploymentId, 'Deployment id');
  await Promise.all([
    delKey(redisKeys.runtimeDeployment(userName, normalizedId)),
    delKey(redisKeys.runtimeDeploymentHeartbeat(userName, normalizedId)),
  ]);
};

export const getRuntimeDeploymentHeartbeat = async (
  userName: string,
  deploymentId: string,
): Promise<RuntimeDeploymentHeartbeat | null> => {
  const value = await getData(
    redisKeys.runtimeDeploymentHeartbeat(
      userName,
      normalizeId(deploymentId, 'Deployment id'),
    ),
    null,
  );
  return value && typeof value === 'object'
    ? (value as RuntimeDeploymentHeartbeat)
    : null;
};

export const saveRuntimeDeploymentHeartbeat = async (
  userName: string,
  heartbeat: RuntimeDeploymentHeartbeat,
) => {
  await setData(
    redisKeys.runtimeDeploymentHeartbeat(
      userName,
      normalizeId(heartbeat.deploymentId, 'Deployment id'),
    ),
    heartbeat,
    { expire: 0 },
  );
  return heartbeat;
};
