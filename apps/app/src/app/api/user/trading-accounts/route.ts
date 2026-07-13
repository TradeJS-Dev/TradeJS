import { NextRequest, NextResponse } from 'next/server';
import {
  getTradingAccount,
  listTradingAccounts,
  saveTradingAccount,
} from '@tradejs/infra/tradingAccounts';
import { getUserSettings } from '@tradejs/infra/userSettings';
import { isMarketUniverse, type TradingAccountRef } from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const maskSecret = (value?: string) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? `${'*'.repeat(12)}${trimmed.slice(-4)}` : '';
};

const toPublicAccount = (account: TradingAccountRef) => {
  const { apiKey, apiSecret, ...safe } = account;
  return {
    ...safe,
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecret),
    maskedApiKey: maskSecret(apiKey),
    maskedApiSecret: maskSecret(apiSecret),
  };
};

const migrateLegacyBybitAccount = async (
  userName: string,
  accounts: TradingAccountRef[],
) => {
  const upgradedAccounts = await Promise.all(
    accounts.map((account) =>
      account.provider === 'bybit' && !account.universes?.includes('tradfi')
        ? saveTradingAccount(userName, {
            ...account,
            universes: ['crypto', 'tradfi'],
          })
        : account,
    ),
  );
  if (upgradedAccounts.some(({ provider }) => provider === 'bybit')) {
    return upgradedAccounts;
  }
  const settings = await getUserSettings(userName);
  if (!settings.BYBIT_API_KEY || !settings.BYBIT_API_SECRET) {
    return upgradedAccounts;
  }
  const migrated = await saveTradingAccount(userName, {
    id: 'bybit-default',
    label: 'Bybit',
    provider: 'bybit',
    enabled: true,
    isDefault: true,
    universes: ['crypto', 'tradfi'],
    environment: 'mainnet',
    apiKey: settings.BYBIT_API_KEY,
    apiSecret: settings.BYBIT_API_SECRET,
  });
  return [...upgradedAccounts, migrated].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
};

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accounts = await migrateLegacyBybitAccount(
    userName,
    await listTradingAccounts(userName),
  );
  return NextResponse.json({ accounts: accounts.map(toPublicAccount) });
};

export const POST = async (request: NextRequest) => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Partial<TradingAccountRef>;
    const id = String(body.id ?? '').trim();
    const label = String(body.label ?? '').trim();
    const provider = String(body.provider ?? '')
      .trim()
      .toLowerCase();
    const universes = Array.isArray(body.universes)
      ? body.universes.filter(isMarketUniverse)
      : [];
    if (!id || !label || !provider || !universes.length) {
      return NextResponse.json(
        { error: 'id, label, provider and universes are required' },
        { status: 400 },
      );
    }
    const existing = await getTradingAccount(userName, id);
    const apiKey =
      typeof body.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : existing?.apiKey;
    const apiSecret =
      typeof body.apiSecret === 'string' && body.apiSecret.trim()
        ? body.apiSecret.trim()
        : existing?.apiSecret;
    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: 'apiKey and apiSecret are required for a new account' },
        { status: 400 },
      );
    }
    const account = await saveTradingAccount(userName, {
      ...existing,
      id,
      label,
      provider,
      enabled: body.enabled !== false,
      isDefault: Boolean(body.isDefault),
      universes,
      environment: body.environment === 'testnet' ? 'testnet' : 'mainnet',
      readOnly: Boolean(body.readOnly),
      apiKey,
      apiSecret,
    });
    return NextResponse.json({ account: toPublicAccount(account) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
};
