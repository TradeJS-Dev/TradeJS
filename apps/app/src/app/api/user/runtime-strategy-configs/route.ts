import { NextRequest, NextResponse } from 'next/server';
import { getAvailableStrategyNames } from '@tradejs/node/strategies';
import {
  listTradingAccounts,
  resolveTradingAccount,
} from '@tradejs/infra/tradingAccounts';
import { getData, getKeys, redisKeys, setData } from '@tradejs/infra/redis';
import type { Interval, MarketUniverse, StrategyConfig } from '@tradejs/types';
import { getCurrentUserName } from '#app/lib/currentUser';
import { resolveStrategyConfigIdentityByKey } from '#app/lib/runtimeStrategies';

export const dynamic = 'force-dynamic';

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const INTERVALS = new Set([
  '1',
  '3',
  '5',
  '15',
  '30',
  '60',
  '120',
  '240',
  '360',
  '720',
  '1440',
]);

type StoredRuntimeConfig = {
  key: string;
  strategyName: string;
  configId: string;
  config: StrategyConfig;
};

const loadConfigs = async (
  userName: string,
): Promise<StoredRuntimeConfig[]> => {
  const keys = await getKeys(`${redisKeys.strategies(userName)}:`);
  const rows = await Promise.all(
    keys.map(async (key): Promise<StoredRuntimeConfig | null> => {
      const identity = resolveStrategyConfigIdentityByKey(userName, key);
      if (!identity) return null;
      const config = (await getData(key, null)) as StrategyConfig | null;
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return null;
      }
      return { key, ...identity, config };
    }),
  );
  return rows.filter((row): row is StoredRuntimeConfig => row != null);
};

const normalizeConfigId = (value: unknown) => {
  const configId = String(value ?? '').trim();
  if (!configId) throw new Error('Config id is required');
  if (!/^[a-zA-Z0-9_-]+$/.test(configId)) {
    throw new Error('Config id may contain only letters, numbers, _ and -');
  }
  if (configId === 'results')
    throw new Error('Config id "results" is reserved');
  return configId;
};

const normalizeUniverse = (value: unknown): MarketUniverse =>
  value === 'tradfi' ? 'tradfi' : 'crypto';

const normalizeInterval = (value: unknown): Interval => {
  const interval = String(value ?? '15');
  if (!INTERVALS.has(interval))
    throw new Error(`Unsupported timeframe: ${interval}`);
  return interval as Interval;
};

const normalizeAccountId = (value: unknown) => {
  const accountId = String(value ?? '').trim();
  return accountId || undefined;
};

const resolveEffectiveAccountId = async ({
  userName,
  config,
}: {
  userName: string;
  config: StrategyConfig;
}) => {
  const universe = normalizeUniverse(config.UNIVERSE);
  const account = await resolveTradingAccount({
    userName,
    accountId: normalizeAccountId(config.ACCOUNT_ID),
    provider: 'bybit',
    universe,
  });
  return account?.id ?? null;
};

const assertNoEnabledAccountConflict = async ({
  userName,
  strategyName,
  configId,
  config,
  existingConfigs,
}: {
  userName: string;
  strategyName: string;
  configId: string;
  config: StrategyConfig;
  existingConfigs: StoredRuntimeConfig[];
}) => {
  if (config.ENABLE === false) return;
  const accountId = await resolveEffectiveAccountId({ userName, config });
  if (!accountId) {
    throw new Error(
      `No enabled Bybit account supports ${normalizeUniverse(config.UNIVERSE)}. Connect an account or save this config as disabled.`,
    );
  }
  for (const candidate of existingConfigs) {
    if (
      candidate.strategyName !== strategyName ||
      candidate.configId === configId ||
      candidate.config.ENABLE === false
    ) {
      continue;
    }
    const candidateAccountId = await resolveEffectiveAccountId({
      userName,
      config: candidate.config,
    });
    if (candidateAccountId === accountId) {
      throw new Error(
        `${strategyName} config "${candidate.configId}" already uses account "${accountId}". One strategy can run only once per account.`,
      );
    }
  }
};

const toResponseConfig = async (
  userName: string,
  row: StoredRuntimeConfig,
) => ({
  strategyName: row.strategyName,
  configId: row.configId,
  interval: normalizeInterval(row.config.INTERVAL),
  universe: normalizeUniverse(row.config.UNIVERSE),
  accountId: normalizeAccountId(row.config.ACCOUNT_ID) ?? null,
  effectiveAccountId: await resolveEffectiveAccountId({
    userName,
    config: row.config,
  }).catch(() => null),
  enabled: row.config.ENABLE !== false,
  config: row.config,
});

export const GET = async () => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [configs, strategyNames, accounts] = await Promise.all([
    loadConfigs(userName),
    getAvailableStrategyNames(projectRoot),
    listTradingAccounts(userName),
  ]);
  return NextResponse.json({
    configs: await Promise.all(
      configs.map((row) => toResponseConfig(userName, row)),
    ),
    strategyNames,
    accounts: accounts.map(
      ({ apiKey: _apiKey, apiSecret: _apiSecret, ...account }) => account,
    ),
    intervals: [...INTERVALS],
  });
};

const save = async (request: NextRequest, editing: boolean) => {
  const userName = await getCurrentUserName();
  if (!userName)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const strategyName = String(body.strategyName ?? '').trim();
    const configId = normalizeConfigId(body.configId);
    const availableStrategies = await getAvailableStrategyNames(projectRoot);
    if (!strategyName || !availableStrategies.includes(strategyName)) {
      throw new Error(`Unknown strategy: ${strategyName || '(empty)'}`);
    }
    const existingConfigs = await loadConfigs(userName);
    const existing = existingConfigs.find(
      (row) => row.strategyName === strategyName && row.configId === configId,
    );
    if (editing && !existing)
      throw new Error('Runtime strategy config not found');
    if (!editing && existing)
      throw new Error('Runtime strategy config already exists');
    const parameters = body.parameters;
    if (
      !parameters ||
      typeof parameters !== 'object' ||
      Array.isArray(parameters)
    ) {
      throw new Error('Strategy parameters must be a JSON object');
    }
    const interval = normalizeInterval(body.interval);
    const universe = normalizeUniverse(body.universe);
    const accountId = normalizeAccountId(body.accountId);
    const config: StrategyConfig = {
      ...(parameters as StrategyConfig),
      ENABLE: body.enabled !== false,
      INTERVAL: interval,
      UNIVERSE: universe,
    };
    if (accountId) config.ACCOUNT_ID = accountId;
    else delete config.ACCOUNT_ID;

    await assertNoEnabledAccountConflict({
      userName,
      strategyName,
      configId,
      config,
      existingConfigs,
    });
    const key = redisKeys.strategyConfig(userName, strategyName, configId);
    await setData(key, config, { expire: 0 });
    return NextResponse.json({
      config: await toResponseConfig(userName, {
        key,
        strategyName,
        configId,
        config,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('already') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
};

export const POST = (request: NextRequest) => save(request, false);
export const PATCH = (request: NextRequest) => save(request, true);
