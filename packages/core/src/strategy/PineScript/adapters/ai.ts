import { StrategyAiAdapter } from '@types';
import { mapAiRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import { PineScriptConfig } from '../config';

export const pineScriptAiAdapter: StrategyAiAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<PineScriptConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
