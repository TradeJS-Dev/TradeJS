import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import { AdaptiveMomentumRibbonConfig } from '../config';
import { StrategyAiAdapter } from '@tradejs/types';

export const adaptiveMomentumRibbonAiAdapter: StrategyAiAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        AdaptiveMomentumRibbonConfig,
        'AI_ENABLED' | 'MIN_AI_QUALITY'
      >,
    ),
};
