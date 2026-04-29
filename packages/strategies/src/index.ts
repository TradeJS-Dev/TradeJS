import { defineStrategyPlugin } from '@tradejs/core/config';
import { type StrategyConfig } from '@tradejs/types';
import { adaptiveMomentumRibbonManifest } from './AdaptiveMomentumRibbon/manifest';
import { breakoutManifest } from './Breakout/manifest';
import { maStrategyManifest } from './MaStrategy/manifest';
import { reverseTrendLineManifest } from './ReverseTrendLine/manifest';
import { trendShiftManifest } from './TrendShift/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';
import { config as adaptiveMomentumRibbonDefaultConfig } from './AdaptiveMomentumRibbon/config';
import { config as breakoutDefaultConfig } from './Breakout/config';
import { config as maStrategyDefaultConfig } from './MaStrategy/config';
import { config as reverseTrendLineDefaultConfig } from './ReverseTrendLine/config';
import { config as trendShiftDefaultConfig } from './TrendShift/config';
import { config as trendLineDefaultConfig } from './TrendLine/config';
import { config as volumeDivergenceDefaultConfig } from './VolumeDivergence/config';
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
    manifest: trendShiftManifest,
    creator: createLazyStrategyCreator(
      () => import('./TrendShift/strategy'),
      'TrendShiftStrategyCreator',
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

const builtInStrategyDefaultConfigs: Record<string, StrategyConfig> = {
  Breakout: breakoutDefaultConfig,
  TrendLine: trendLineDefaultConfig,
  TrendShift: trendShiftDefaultConfig,
  ReverseTrendLine: reverseTrendLineDefaultConfig,
  MaStrategy: maStrategyDefaultConfig,
  AdaptiveMomentumRibbon: adaptiveMomentumRibbonDefaultConfig,
  VolumeDivergence: volumeDivergenceDefaultConfig,
};

export const getBuiltInStrategyDefaultConfig = (
  strategyName: string,
): StrategyConfig | undefined => builtInStrategyDefaultConfigs[strategyName];

export { adaptiveMomentumRibbonDefaultConfig };
export { breakoutDefaultConfig };
export { maStrategyDefaultConfig };
export { trendLineDefaultConfig };
export { trendShiftDefaultConfig };
export { reverseTrendLineDefaultConfig };
export { volumeDivergenceDefaultConfig };
export { adaptiveMomentumRibbonAiAdapter } from './AdaptiveMomentumRibbon/adapters/ai';
export { adaptiveMomentumRibbonMlAdapter } from './AdaptiveMomentumRibbon/adapters/ml';
export { maStrategyAiAdapter } from './MaStrategy/adapters/ai';
export { maStrategyMlAdapter } from './MaStrategy/adapters/ml';
export { reverseTrendLineAiAdapter } from './ReverseTrendLine/adapters/ai';
export { trendShiftAiAdapter } from './TrendShift/adapters/ai';
export { volumeDivergenceAiAdapter } from './VolumeDivergence/adapters/ai';
export { volumeDivergenceMlAdapter } from './VolumeDivergence/adapters/ml';

export default defineStrategyPlugin({ strategyEntries });
