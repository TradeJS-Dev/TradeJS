import { StrategyMlAdapter } from '@types';
import { mapMlRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import type { MaStrategyConfig } from '../config';

export const maStrategyMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(
      config as Pick<MaStrategyConfig, 'ML_ENABLED' | 'ML_THRESHOLD'>,
    ),
};
