import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import type {
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
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
  strategyResults: StrategyResults;
}

export const loadRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
}: {
  userName: string;
  projectRoot: string;
  deployment?: RuntimeDeployment | null;
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
          strategyCreator,
          strategyConfig: {
            ...strategyConfig,
            ...deploymentStrategy?.config,
            ...(deploymentStrategy?.policyProfileId
              ? { POLICY_PROFILE_ID: deploymentStrategy.policyProfileId }
              : {}),
          },
          strategyResults: (strategyResults ?? {}) as StrategyResults,
        };
      },
    ),
  );
  return strategyConfigs.filter(Boolean) as StrategyRuntimeConfig[];
};
