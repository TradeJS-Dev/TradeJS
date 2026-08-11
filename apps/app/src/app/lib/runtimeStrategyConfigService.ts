import {
  loadRuntimeStrategyConfigs,
  saveRuntimeStrategyConfig,
  type RuntimeStrategyConfigRecord,
} from '@tradejs/infra/runtimeStrategyConfigs';
import {
  listTradingAccounts,
  resolveTradingAccount,
} from '@tradejs/infra/tradingAccounts';
import { getAvailableStrategyNames } from '@tradejs/node/strategies';
import type { Interval, MarketUniverse, StrategyConfig } from '@tradejs/types';

export const RUNTIME_STRATEGY_INTERVALS = [
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
] as const;

const intervalSet = new Set<string>(RUNTIME_STRATEGY_INTERVALS);

export class RuntimeStrategyConfigServiceError extends Error {
  constructor(
    message: string,
    readonly code: 'conflict' | 'not_found' | 'validation' = 'validation',
  ) {
    super(message);
    this.name = 'RuntimeStrategyConfigServiceError';
  }
}

type StoredRuntimeConfig = RuntimeStrategyConfigRecord & {
  config: StrategyConfig;
};

export interface SaveRuntimeStrategyConfigInput {
  strategyName?: unknown;
  configId?: unknown;
  interval?: unknown;
  universe?: unknown;
  accountId?: unknown;
  enabled?: unknown;
  parameters?: unknown;
}

const loadConfigs = async (userName: string): Promise<StoredRuntimeConfig[]> =>
  (await loadRuntimeStrategyConfigs(userName)).map(
    ({ strategyConfig, ...record }) => ({
      ...record,
      strategyConfig,
      config: strategyConfig,
    }),
  );

const normalizeConfigId = (value: unknown) => {
  const configId = String(value ?? '').trim();
  if (!configId)
    throw new RuntimeStrategyConfigServiceError('Config id is required');
  if (!/^[a-zA-Z0-9_-]+$/.test(configId)) {
    throw new RuntimeStrategyConfigServiceError(
      'Config id may contain only letters, numbers, _ and -',
    );
  }
  if (configId === 'results') {
    throw new RuntimeStrategyConfigServiceError(
      'Config id "results" is reserved',
    );
  }
  return configId;
};

const normalizeUniverse = (value: unknown): MarketUniverse =>
  value === 'tradfi' ? 'tradfi' : 'crypto';

const normalizeInterval = (value: unknown): Interval => {
  const interval = String(value ?? '15');
  if (!intervalSet.has(interval)) {
    throw new RuntimeStrategyConfigServiceError(
      `Unsupported timeframe: ${interval}`,
    );
  }
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
    throw new RuntimeStrategyConfigServiceError(
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
      throw new RuntimeStrategyConfigServiceError(
        `${strategyName} config "${candidate.configId}" already uses account "${accountId}". One strategy can run only once per account.`,
        'conflict',
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

export const getRuntimeStrategyConfigOptions = async ({
  userName,
  projectRoot,
}: {
  userName: string;
  projectRoot: string;
}) => {
  const [configs, strategyNames, accounts] = await Promise.all([
    loadConfigs(userName),
    getAvailableStrategyNames(projectRoot),
    listTradingAccounts(userName),
  ]);

  return {
    configs: await Promise.all(
      configs.map((row) => toResponseConfig(userName, row)),
    ),
    strategyNames,
    accounts: accounts.map(
      ({ apiKey: _apiKey, apiSecret: _apiSecret, ...account }) => account,
    ),
    intervals: [...RUNTIME_STRATEGY_INTERVALS],
  };
};

export const saveRuntimeStrategyConfigForUser = async ({
  userName,
  projectRoot,
  input,
  editing,
}: {
  userName: string;
  projectRoot: string;
  input: SaveRuntimeStrategyConfigInput;
  editing: boolean;
}) => {
  const strategyName = String(input.strategyName ?? '').trim();
  const configId = normalizeConfigId(input.configId);
  const availableStrategies = await getAvailableStrategyNames(projectRoot);
  if (!strategyName || !availableStrategies.includes(strategyName)) {
    throw new RuntimeStrategyConfigServiceError(
      `Unknown strategy: ${strategyName || '(empty)'}`,
    );
  }

  const existingConfigs = await loadConfigs(userName);
  const existing = existingConfigs.find(
    (row) => row.strategyName === strategyName && row.configId === configId,
  );
  if (editing && !existing) {
    throw new RuntimeStrategyConfigServiceError(
      'Runtime strategy config not found',
      'not_found',
    );
  }
  if (!editing && existing) {
    throw new RuntimeStrategyConfigServiceError(
      'Runtime strategy config already exists',
      'conflict',
    );
  }

  if (
    !input.parameters ||
    typeof input.parameters !== 'object' ||
    Array.isArray(input.parameters)
  ) {
    throw new RuntimeStrategyConfigServiceError(
      'Strategy parameters must be a JSON object',
    );
  }

  const interval = normalizeInterval(input.interval);
  const universe = normalizeUniverse(input.universe);
  const accountId = normalizeAccountId(input.accountId);
  const config: StrategyConfig = {
    ...(input.parameters as StrategyConfig),
    ENABLE: input.enabled !== false,
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
  const saved = await saveRuntimeStrategyConfig({
    userName,
    strategyName,
    configId,
    strategyConfig: config,
  });

  return {
    config: await toResponseConfig(userName, {
      ...saved,
      config,
    }),
  };
};
