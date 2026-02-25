import { StrategyMlAdapter } from '@types';
import { mapMlRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import { BreakoutConfig } from '../config';

export const breakoutMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(config as Pick<BreakoutConfig, 'ML_ENABLED'>),
};
