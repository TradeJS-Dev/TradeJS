import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import type {
  StrategyConfig,
  StrategyCreator,
  StrategyResults,
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
}: {
  userName: string;
  projectRoot: string;
}): Promise<StrategyRuntimeConfig[]> => {
  const strategyConfigs = await Promise.all(
    (await loadRuntimeStrategyConfigs(userName)).map(
      async ({
        key,
        strategyName,
        strategyConfig,
      }): Promise<StrategyRuntimeConfig | null> => {
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
          strategyConfig,
          strategyResults: (strategyResults ?? {}) as StrategyResults,
        };
      },
    ),
  );
  return strategyConfigs.filter(Boolean) as StrategyRuntimeConfig[];
};
