import { mapMlRuntimeFromConfig } from '@tradejs/core/strategies';
import type { MaStrategyConfig } from '../config';
import { StrategyMlAdapter } from '@tradejs/types';

export const maStrategyMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(
      config as Pick<MaStrategyConfig, 'ML_ENABLED' | 'ML_THRESHOLD'>,
    ),
};
