const mockDelKey = jest.fn();
const mockGetData = jest.fn();
const mockGetKeys = jest.fn();
const mockSetData = jest.fn();

function userKey(userName: string) {
  return `users:${userName}`;
}
function tradingAccountKey(userName: string, accountId: string) {
  return `users:${userName}:trading-accounts:${accountId}`;
}
function tradingAccountsKey(userName: string) {
  return `users:${userName}:trading-accounts:`;
}
jest.mock('../redis', () => ({
  delKey: (...args: unknown[]) => mockDelKey(...args),
  getData: (...args: unknown[]) => mockGetData(...args),
  getKeys: (...args: unknown[]) => mockGetKeys(...args),
  redisKeys: {
    user: userKey,
    tradingAccount: tradingAccountKey,
    tradingAccounts: tradingAccountsKey,
  },
  setData: (...args: unknown[]) => mockSetData(...args),
}));

import {
  deleteTradingAccount,
  getTradingAccount,
  listTradingAccounts,
  resolveTradingAccount,
  saveTradingAccount,
} from '../tradingAccounts';
import type { TradingAccountRef } from '@tradejs/types';

const makeAccount = (
  overrides: Partial<TradingAccountRef> = {},
): TradingAccountRef => ({
  id: 'crypto-main',
  label: 'Crypto Main',
  provider: 'bybit',
  enabled: true,
  universes: ['crypto'],
  environment: 'mainnet',
  apiKey: 'key',
  apiSecret: 'secret',
  ...overrides,
});

describe('trading accounts persistence', () => {
  const store = new Map<string, unknown>();

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    mockGetData.mockImplementation(async (key: string, fallback: unknown) =>
      store.has(key) ? store.get(key) : fallback,
    );
    mockGetKeys.mockImplementation(async (prefix: string) =>
      [...store.keys()].filter((key) => key.startsWith(prefix)),
    );
    mockSetData.mockImplementation(async (key: string, value: unknown) => {
      store.set(key, value);
    });
    mockDelKey.mockImplementation(async (key: string) => store.delete(key));
  });

  it('normalizes accounts, deduplicates universes and sorts the list', async () => {
    await saveTradingAccount(
      'root',
      makeAccount({
        id: ' Crypto Main ',
        label: ' Z account ',
        provider: ' ByBit ',
        universes: ['crypto', 'crypto'],
      }),
    );
    await saveTradingAccount(
      'root',
      makeAccount({ id: 'tradfi-main', label: 'A account' }),
    );
    store.set('users:root:trading-accounts:invalid', { no: 'account' });

    await expect(getTradingAccount('root', ' CRYPTO MAIN ')).resolves.toEqual(
      expect.objectContaining({
        id: 'crypto-main',
        label: 'Z account',
        provider: 'bybit',
        universes: ['crypto'],
      }),
    );
    await expect(listTradingAccounts('root')).resolves.toEqual([
      expect.objectContaining({ id: 'tradfi-main' }),
      expect.objectContaining({ id: 'crypto-main' }),
    ]);
  });

  it('keeps only one default account per provider', async () => {
    await saveTradingAccount(
      'root',
      makeAccount({ id: 'first', isDefault: true }),
    );
    await saveTradingAccount(
      'root',
      makeAccount({ id: 'second', isDefault: true }),
    );

    await expect(getTradingAccount('root', 'first')).resolves.toEqual(
      expect.objectContaining({ isDefault: false }),
    );
    await expect(getTradingAccount('root', 'second')).resolves.toEqual(
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('keeps independent defaults for disjoint universes', async () => {
    await saveTradingAccount(
      'root',
      makeAccount({
        id: 'crypto-default',
        provider: 'broker',
        universes: ['crypto'],
        isDefault: true,
      }),
    );
    await saveTradingAccount(
      'root',
      makeAccount({
        id: 'tradfi-default',
        provider: 'broker',
        universes: ['tradfi'],
        isDefault: true,
      }),
    );

    await expect(getTradingAccount('root', 'crypto-default')).resolves.toEqual(
      expect.objectContaining({ isDefault: true }),
    );
    await expect(getTradingAccount('root', 'tradfi-default')).resolves.toEqual(
      expect.objectContaining({ isDefault: true }),
    );
  });

  it('validates an explicitly selected account', async () => {
    await saveTradingAccount(
      'root',
      makeAccount({
        id: 'tradfi-main',
        provider: 'broker',
        universes: ['tradfi'],
      }),
    );

    await expect(
      resolveTradingAccount({
        userName: 'root',
        accountId: 'tradfi-main',
        provider: 'broker',
        universe: 'tradfi',
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 'tradfi-main' }));
    await expect(
      resolveTradingAccount({
        userName: 'root',
        accountId: 'tradfi-main',
        provider: 'binance',
        universe: 'tradfi',
      }),
    ).rejects.toThrow('belongs to broker, not binance');
    await expect(
      resolveTradingAccount({
        userName: 'root',
        accountId: 'tradfi-main',
        provider: 'broker',
        universe: 'crypto',
      }),
    ).rejects.toThrow('does not support universe crypto');

    await saveTradingAccount(
      'root',
      makeAccount({ id: 'disabled', enabled: false }),
    );
    await expect(
      resolveTradingAccount({
        userName: 'root',
        accountId: 'disabled',
        provider: 'bybit',
      }),
    ).rejects.toThrow('Trading account is disabled');

    await expect(
      resolveTradingAccount({
        userName: 'root',
        accountId: 'missing',
        provider: 'bybit',
      }),
    ).rejects.toThrow('Trading account not found: missing');
  });

  it('selects a default or sole account but refuses an ambiguous selection', async () => {
    await saveTradingAccount('root', makeAccount({ id: 'sole' }));
    await expect(
      resolveTradingAccount({ userName: 'root', provider: 'bybit' }),
    ).resolves.toEqual(expect.objectContaining({ id: 'sole' }));

    await saveTradingAccount('root', makeAccount({ id: 'other' }));
    await expect(
      resolveTradingAccount({ userName: 'root', provider: 'bybit' }),
    ).resolves.toBeNull();

    await saveTradingAccount(
      'root',
      makeAccount({ id: 'other', isDefault: true }),
    );
    await expect(
      resolveTradingAccount({ userName: 'root', provider: 'bybit' }),
    ).resolves.toEqual(expect.objectContaining({ id: 'other' }));
  });

  it('selects defaults only from accounts compatible with the universe', async () => {
    await saveTradingAccount(
      'root',
      makeAccount({ id: 'crypto-only', provider: 'broker' }),
    );

    await expect(
      resolveTradingAccount({
        userName: 'root',
        provider: 'broker',
        universe: 'tradfi',
      }),
    ).resolves.toBeNull();
  });

  it('does not resolve accounts from legacy user settings', async () => {
    store.set(userKey('legacy'), {
      BYBIT_API_KEY: ' legacy-key ',
      BYBIT_API_SECRET: ' legacy-secret ',
    });

    await expect(
      resolveTradingAccount({
        userName: 'legacy',
        provider: 'bybit',
        universe: 'crypto',
      }),
    ).resolves.toBeNull();
    await expect(
      resolveTradingAccount({
        userName: 'legacy',
        provider: 'bybit',
        universe: 'tradfi',
      }),
    ).resolves.toBeNull();

    await expect(
      resolveTradingAccount({
        userName: 'no-credentials',
        provider: 'bybit',
        universe: 'crypto',
      }),
    ).resolves.toBeNull();
  });

  it('normalizes account ids on deletion and rejects empty ids', async () => {
    await saveTradingAccount('root', makeAccount({ id: 'delete-me' }));

    await deleteTradingAccount('root', ' Delete Me ');

    expect(mockDelKey).toHaveBeenCalledWith(
      tradingAccountKey('root', 'delete-me'),
    );
    await expect(getTradingAccount('root', '   ')).rejects.toThrow(
      'Account id is required',
    );
  });
});
