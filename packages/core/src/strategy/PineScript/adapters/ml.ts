import { StrategyMlAdapter } from '@types';
import { mapMlRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import { PineScriptConfig } from '../config';

export const pineScriptMlAdapter: StrategyMlAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapMlRuntimeFromConfig(
      config as Pick<PineScriptConfig, 'ML_ENABLED' | 'ML_THRESHOLD'>,
    ),
};
