import { StrategyManifest } from '@tradejs/types';
import { liquidityTailsAiAdapter } from './adapters/ai';

export const liquidityTailsManifest: StrategyManifest = {
  name: 'LiquidityTails',
  aiAdapter: liquidityTailsAiAdapter,
};
