import { StrategyMlAdapter } from '@types';
import { mapMlRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import { AdaptiveMomentumRibbonConfig } from '../config';

export const adaptiveMomentumRibbonMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(
      config as Pick<
        AdaptiveMomentumRibbonConfig,
        'ML_ENABLED' | 'ML_THRESHOLD'
      >,
    ),
};
