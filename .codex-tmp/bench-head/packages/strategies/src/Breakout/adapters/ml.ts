import { mapMlRuntimeFromConfig } from '@tradejs/core/strategies';
import { BreakoutConfig } from '../config';
import { StrategyMlAdapter } from '@tradejs/types';

export const breakoutMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(config as Pick<BreakoutConfig, 'ML_ENABLED'>),
};
