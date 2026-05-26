import { defineStrategyPlugin } from '@tradejs/core/config';
import { type StrategyConfig } from '@tradejs/types';
import { adaptiveMomentumRibbonManifest } from './AdaptiveMomentumRibbon/manifest';
import { adaptiveTrendChannelManifest } from './AdaptiveTrendChannel/manifest';
import { breakoutManifest } from './Breakout/manifest';
import { doubleTapManifest } from './DoubleTap/manifest';
import { maStrategyManifest } from './MaStrategy/manifest';
import { mslLiquidityTailsManifest } from './MSLLiquidityTails/manifest';
import { mslLiquidityZonesManifest } from './MSLLiquidityZones/manifest';
import { reverseTrendLineManifest } from './ReverseTrendLine/manifest';
import { structureZonesManifest } from './StructureZones/manifest';
import { trendFollowManifest } from './TrendFollow/manifest';
import { trendShiftManifest } from './TrendShift/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';
import { config as adaptiveMomentumRibbonDefaultConfig } from './AdaptiveMomentumRibbon/config';
import { AdaptiveMomentumRibbonStrategyCreator } from './AdaptiveMomentumRibbon/strategy';
import { config as adaptiveTrendChannelDefaultConfig } from './AdaptiveTrendChannel/config';
import { AdaptiveTrendChannelStrategyCreator } from './AdaptiveTrendChannel/strategy';
import { config as breakoutDefaultConfig } from './Breakout/config';
import { BreakoutStrategyCreator } from './Breakout/strategy';
import { config as doubleTapDefaultConfig } from './DoubleTap/config';
import { DoubleTapStrategyCreator } from './DoubleTap/strategy';
import { config as maStrategyDefaultConfig } from './MaStrategy/config';
import { MaStrategyCreator } from './MaStrategy/strategy';
import { config as liquidityTailsDefaultConfig } from './MSLLiquidityTails/config';
import { MSLLiquidityTailsStrategyCreator } from './MSLLiquidityTails/strategy';
import { config as liquidityZonesDefaultConfig } from './MSLLiquidityZones/config';
import { MSLLiquidityZonesStrategyCreator } from './MSLLiquidityZones/strategy';
import { config as reverseTrendLineDefaultConfig } from './ReverseTrendLine/config';
import { ReverseTrendLineStrategyCreator } from './ReverseTrendLine/strategy';
import { config as structureZonesDefaultConfig } from './StructureZones/config';
import { StructureZonesStrategyCreator } from './StructureZones/strategy';
import { config as trendFollowDefaultConfig } from './TrendFollow/config';
import { TrendFollowStrategyCreator } from './TrendFollow/strategy';
import { config as trendShiftDefaultConfig } from './TrendShift/config';
import { TrendShiftStrategyCreator } from './TrendShift/strategy';
import { config as trendLineDefaultConfig } from './TrendLine/config';
import { TrendlineStrategyCreator } from './TrendLine/strategy';
import { config as volumeDivergenceDefaultConfig } from './VolumeDivergence/config';
import { VolumeDivergenceStrategyCreator } from './VolumeDivergence/strategy';
import { type StrategyRegistryEntry } from '@tradejs/types';

export const strategyEntries: StrategyRegistryEntry[] = [
  {
    manifest: breakoutManifest,
    creator: BreakoutStrategyCreator,
  },
  {
    manifest: trendLineManifest,
    creator: TrendlineStrategyCreator,
  },
  {
    manifest: trendShiftManifest,
    creator: TrendShiftStrategyCreator,
  },
  {
    manifest: doubleTapManifest,
    creator: DoubleTapStrategyCreator,
  },
  {
    manifest: mslLiquidityTailsManifest,
    creator: MSLLiquidityTailsStrategyCreator,
  },
  {
    manifest: mslLiquidityZonesManifest,
    creator: MSLLiquidityZonesStrategyCreator,
  },
  {
    manifest: trendFollowManifest,
    creator: TrendFollowStrategyCreator,
  },
  {
    manifest: structureZonesManifest,
    creator: StructureZonesStrategyCreator,
  },
  {
    manifest: reverseTrendLineManifest,
    creator: ReverseTrendLineStrategyCreator,
  },
  {
    manifest: maStrategyManifest,
    creator: MaStrategyCreator,
  },
  {
    manifest: adaptiveMomentumRibbonManifest,
    creator: AdaptiveMomentumRibbonStrategyCreator,
  },
  {
    manifest: adaptiveTrendChannelManifest,
    creator: AdaptiveTrendChannelStrategyCreator,
  },
  {
    manifest: volumeDivergenceManifest,
    creator: VolumeDivergenceStrategyCreator,
  },
];

const builtInStrategyDefaultConfigs: Record<string, StrategyConfig> = {
  Breakout: breakoutDefaultConfig,
  TrendLine: trendLineDefaultConfig,
  TrendShift: trendShiftDefaultConfig,
  DoubleTap: doubleTapDefaultConfig,
  LiquidityTails: liquidityTailsDefaultConfig,
  LiquidityZones: liquidityZonesDefaultConfig,
  TrendFollow: trendFollowDefaultConfig,
  StructureZones: structureZonesDefaultConfig,
  ReverseTrendLine: reverseTrendLineDefaultConfig,
  MaStrategy: maStrategyDefaultConfig,
  AdaptiveMomentumRibbon: adaptiveMomentumRibbonDefaultConfig,
  AdaptiveTrendChannel: adaptiveTrendChannelDefaultConfig,
  VolumeDivergence: volumeDivergenceDefaultConfig,
};

export const getBuiltInStrategyDefaultConfig = (
  strategyName: string,
): StrategyConfig | undefined => builtInStrategyDefaultConfigs[strategyName];

export { adaptiveMomentumRibbonDefaultConfig };
export { adaptiveTrendChannelDefaultConfig };
export { breakoutDefaultConfig };
export { maStrategyDefaultConfig };
export { trendLineDefaultConfig };
export { trendShiftDefaultConfig };
export { doubleTapDefaultConfig };
export { liquidityTailsDefaultConfig };
export { liquidityZonesDefaultConfig };
export { trendFollowDefaultConfig };
export { structureZonesDefaultConfig };
export { reverseTrendLineDefaultConfig };
export { volumeDivergenceDefaultConfig };
export { adaptiveMomentumRibbonAiAdapter } from './AdaptiveMomentumRibbon/adapters/ai';
export { adaptiveMomentumRibbonMlAdapter } from './AdaptiveMomentumRibbon/adapters/ml';
export { adaptiveTrendChannelAiAdapter } from './AdaptiveTrendChannel/adapters/ai';
export { maStrategyAiAdapter } from './MaStrategy/adapters/ai';
export { maStrategyMlAdapter } from './MaStrategy/adapters/ml';
export { reverseTrendLineAiAdapter } from './ReverseTrendLine/adapters/ai';
export { trendShiftAiAdapter } from './TrendShift/adapters/ai';
export { doubleTapAiAdapter } from './DoubleTap/adapters/ai';
export { mslLiquidityTailsAiAdapter as liquidityTailsAiAdapter } from './MSLLiquidityTails/adapters/ai';
export { mslLiquidityZonesAiAdapter as liquidityZonesAiAdapter } from './MSLLiquidityZones/adapters/ai';
export { structureZonesAiAdapter } from './StructureZones/adapters/ai';
export { trendFollowAiAdapter } from './TrendFollow/adapters/ai';
export { volumeDivergenceAiAdapter } from './VolumeDivergence/adapters/ai';
export { volumeDivergenceMlAdapter } from './VolumeDivergence/adapters/ml';

export default defineStrategyPlugin({ strategyEntries });
