import { defineStrategyPlugin } from '@tradejs/core/config';
import { adaptiveMomentumRibbonManifest } from './AdaptiveMomentumRibbon/manifest';
import { breakoutManifest } from './Breakout/manifest';
import { maStrategyManifest } from './MaStrategy/manifest';
import { reverseTrendLineManifest } from './ReverseTrendLine/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';
import {
  type StrategyCreator,
  type StrategyRegistryEntry,
} from '@tradejs/types';

const createLazyStrategyCreator = <TModule extends Record<string, unknown>>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule,
): StrategyCreator => {
  return async (params) => {
    const module = await loader();
    const creator = module[exportName];
    if (typeof creator !== 'function') {
      throw new Error(
        `Strategy creator export "${String(exportName)}" is missing`,
      );
    }
    return (creator as StrategyCreator)(params);
  };
};

export const strategyEntries: StrategyRegistryEntry[] = [
  {
    manifest: breakoutManifest,
    creator: createLazyStrategyCreator(
      () => import('./Breakout/strategy'),
      'BreakoutStrategyCreator',
    ),
  },
  {
    manifest: trendLineManifest,
    creator: createLazyStrategyCreator(
      () => import('./TrendLine/strategy'),
      'TrendlineStrategyCreator',
    ),
  },
  {
    manifest: reverseTrendLineManifest,
    creator: createLazyStrategyCreator(
      () => import('./ReverseTrendLine/strategy'),
      'ReverseTrendLineStrategyCreator',
    ),
  },
  {
    manifest: maStrategyManifest,
    creator: createLazyStrategyCreator(
      () => import('./MaStrategy/strategy'),
      'MaStrategyCreator',
    ),
  },
  {
    manifest: adaptiveMomentumRibbonManifest,
    creator: createLazyStrategyCreator(
      () => import('./AdaptiveMomentumRibbon/strategy'),
      'AdaptiveMomentumRibbonStrategyCreator',
    ),
  },
  {
    manifest: volumeDivergenceManifest,
    creator: createLazyStrategyCreator(
      () => import('./VolumeDivergence/strategy'),
      'VolumeDivergenceStrategyCreator',
    ),
  },
];

export { config as trendLineDefaultConfig } from './TrendLine/config';
export { config as reverseTrendLineDefaultConfig } from './ReverseTrendLine/config';
export { adaptiveMomentumRibbonAiAdapter } from './AdaptiveMomentumRibbon/adapters/ai';
export { adaptiveMomentumRibbonMlAdapter } from './AdaptiveMomentumRibbon/adapters/ml';
export { maStrategyAiAdapter } from './MaStrategy/adapters/ai';
export { maStrategyMlAdapter } from './MaStrategy/adapters/ml';
export { reverseTrendLineAiAdapter } from './ReverseTrendLine/adapters/ai';
export { volumeDivergenceAiAdapter } from './VolumeDivergence/adapters/ai';
export { volumeDivergenceMlAdapter } from './VolumeDivergence/adapters/ml';

export default defineStrategyPlugin({ strategyEntries });
