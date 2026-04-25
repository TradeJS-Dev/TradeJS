import { mapAiRuntimeFromConfig } from '@tradejs/core/strategies';
import type { MaStrategyConfig } from '../config';
import { StrategyAiAdapter } from '@tradejs/types';

export const maStrategyAiAdapter: StrategyAiAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<
        MaStrategyConfig,
        'AI_ENABLED' | 'AI_MODE' | 'MIN_AI_QUALITY'
      >,
    ),
};
