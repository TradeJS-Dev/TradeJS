import { StrategyAiAdapter } from '@types';
import { mapAiRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import { AdaptiveMomentumRibbonConfig } from '../config';

export const adaptiveMomentumRibbonAiAdapter: StrategyAiAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        AdaptiveMomentumRibbonConfig,
        'AI_ENABLED' | 'MIN_AI_QUALITY'
      >,
    ),
};
