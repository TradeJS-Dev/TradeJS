import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import type {
  Interval,
  MarketUniverse,
  StrategyConfig,
  StrategyCreator,
  StrategyResults,
  RuntimeDeployment,
} from '@tradejs/types';
import { getStrategyCreator } from '@tradejs/node/strategies';
import {
  isRuntimeStrategyEnabled,
  loadRuntimeStrategyConfigs,
} from '../runtimeRedis';

export interface StrategyRuntimeConfig {
  strategyName: string;
  configId: string;
  interval: Interval;
  universe: MarketUniverse;
  accountId?: string;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
  strategyResults: StrategyResults;
}

export const loadRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
  connectorName = 'bybit',
  universe,
  accountId,
  interval,
}: {
  userName: string;
  projectRoot: string;
  deployment?: RuntimeDeployment | null;
  connectorName?: string;
  universe?: MarketUniverse;
  accountId?: string;
  interval?: Interval;
}): Promise<StrategyRuntimeConfig[]> => {
  const deploymentStrategies = new Map(
    (deployment?.strategies ?? [])
      .filter(({ enabled }) => enabled !== false)
      .map((strategy) => [strategy.strategyName, strategy]),
  );
  const strategyConfigs = await Promise.all(
    (await loadRuntimeStrategyConfigs(userName)).map(
      async ({
        key,
        strategyName,
        configId,
        strategyConfig,
      }): Promise<StrategyRuntimeConfig | null> => {
        const deploymentStrategy = deployment
          ? deploymentStrategies.get(strategyName)
          : undefined;
        if (deployment && !deploymentStrategy) return null;
        if (!isRuntimeStrategyEnabled(strategyConfig)) {
          logger.info(
            'Skip inactive strategy config by ENABLE=false: %s',
            strategyName,
          );
          return null;
        }
        const configUniverse = (deployment?.universe ??
          (strategyConfig.UNIVERSE === 'tradfi'
            ? 'tradfi'
            : 'crypto')) as MarketUniverse;
        const configInterval = String(
          deployment?.interval ?? strategyConfig.INTERVAL ?? '15',
        ) as Interval;
        const requestedAccountId =
          deployment?.accountId ??
          (typeof strategyConfig.ACCOUNT_ID === 'string' &&
          strategyConfig.ACCOUNT_ID.trim()
            ? strategyConfig.ACCOUNT_ID.trim()
            : undefined);
        const resolvedAccount = await resolveTradingAccount({
          userName,
          accountId: requestedAccountId,
          provider: deployment?.provider ?? connectorName,
          universe: configUniverse,
        });
        const effectiveAccountId = resolvedAccount?.id ?? requestedAccountId;
        const [strategyCreator, strategyResults] = await Promise.all([
          getStrategyCreator(strategyName, projectRoot),
          getData(redisKeys.strategyResults(userName, strategyName), {}),
        ]);
        if (!strategyCreator) {
          logger.warn('Skip unknown strategy config key: %s', key);
          return null;
        }
        return {
          strategyName,
          configId,
          interval: configInterval,
          universe: configUniverse,
          accountId: effectiveAccountId,
          strategyCreator,
          strategyConfig: {
            ...strategyConfig,
            ...deploymentStrategy?.config,
            INTERVAL: configInterval,
            UNIVERSE: configUniverse,
            ...(effectiveAccountId ? { ACCOUNT_ID: effectiveAccountId } : {}),
            ...(deploymentStrategy?.policyProfileId
              ? { POLICY_PROFILE_ID: deploymentStrategy.policyProfileId }
              : {}),
          },
          strategyResults: (strategyResults ?? {}) as StrategyResults,
        };
      },
    ),
  );
  const active = strategyConfigs.filter(Boolean) as StrategyRuntimeConfig[];
  const byStrategyAndAccount = new Map<string, StrategyRuntimeConfig>();
  for (const candidate of active) {
    const conflictKey = `${candidate.strategyName}:${candidate.accountId ?? 'default'}`;
    const existing = byStrategyAndAccount.get(conflictKey);
    if (existing) {
      throw new Error(
        `Runtime strategy conflict: ${candidate.strategyName} configs "${existing.configId}" and "${candidate.configId}" resolve to account "${candidate.accountId ?? 'default'}". Disable one config or select another account.`,
      );
    }
    byStrategyAndAccount.set(conflictKey, candidate);
  }
  return active.filter(
    (candidate) =>
      (!universe || candidate.universe === universe) &&
      (!interval || String(candidate.interval) === String(interval)) &&
      (!accountId || candidate.accountId === accountId),
  );
};
