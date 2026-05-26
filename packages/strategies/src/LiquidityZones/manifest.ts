import { StrategyManifest } from '@tradejs/types';
import { liquidityZonesAiAdapter } from './adapters/ai';

export const liquidityZonesManifest: StrategyManifest = {
  name: 'LiquidityZones',
  aiAdapter: liquidityZonesAiAdapter,
};
