import { StrategyManifest } from '@tradejs/types';
import { mslLiquidityTailsAiAdapter } from './adapters/ai';

export const mslLiquidityTailsManifest: StrategyManifest = {
  name: 'LiquidityTails',
  aiAdapter: mslLiquidityTailsAiAdapter,
};
