import { mapMlRuntimeFromConfig } from '@tradejs/core/strategies';
import { AdaptiveMomentumRibbonConfig } from '../config';
import { StrategyMlAdapter } from '@tradejs/types';

export const adaptiveMomentumRibbonMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(
      config as Pick<
        AdaptiveMomentumRibbonConfig,
        'ML_ENABLED' | 'ML_THRESHOLD'
      >,
    ),
};
