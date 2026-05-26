import { StrategyManifest } from '@tradejs/types';
import { mslLiquidityZonesAiAdapter } from './adapters/ai';

export const mslLiquidityZonesManifest: StrategyManifest = {
  name: 'LiquidityZones',
  aiAdapter: mslLiquidityZonesAiAdapter,
};
