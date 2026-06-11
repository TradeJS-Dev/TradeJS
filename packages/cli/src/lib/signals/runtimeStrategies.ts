import { logger } from '@tradejs/infra/logger';
import type { StrategyConfig, StrategyCreator } from '@tradejs/types';
import { getStrategyCreator } from '@tradejs/node/strategies';
import {
  isRuntimeStrategyEnabled,
  loadRuntimeStrategyConfigs,
} from '../runtimeRedis';

export interface StrategyRuntimeConfig {
  strategyName: string;
  strategyCreator: StrategyCreator;
  strategyConfig: StrategyConfig;
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
        const strategyCreator = await getStrategyCreator(
          strategyName,
          projectRoot,
        );
        if (!strategyCreator) {
          logger.warn('Skip unknown strategy config key: %s', key);
          return null;
        }
        return {
          strategyName,
          strategyCreator,
          strategyConfig,
        };
      },
    ),
  );
  return strategyConfigs.filter(Boolean) as StrategyRuntimeConfig[];
};
