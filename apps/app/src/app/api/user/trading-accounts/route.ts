import { NextRequest, NextResponse } from 'next/server';
import {
  getTradingAccount,
  listTradingAccounts,
  saveTradingAccount,
} from '@tradejs/infra/tradingAccounts';
import { isMarketUniverse, type TradingAccountRef } from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

const toPublicAccount = (account: TradingAccountRef) => {
  const { apiKey, apiSecret, ...safe } = account;
  return {
    ...safe,
    hasApiKey: Boolean(apiKey),
    hasApiSecret: Boolean(apiSecret),
  };
};

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const accounts = await listTradingAccounts(userName);
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
