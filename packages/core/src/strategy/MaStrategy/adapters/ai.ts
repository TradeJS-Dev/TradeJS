import { StrategyAiAdapter } from '@types';
import { mapAiRuntimeFromConfig } from '@utils/strategyHelpers/signalBuilders';
import type { MaStrategyConfig } from '../config';

export const maStrategyAiAdapter: StrategyAiAdapter = {
  mapEntryRuntimeFromConfig: (config) =>
    mapAiRuntimeFromConfig(
      config as Pick<MaStrategyConfig, 'AI_ENABLED' | 'MIN_AI_QUALITY'>,
    ),
};
