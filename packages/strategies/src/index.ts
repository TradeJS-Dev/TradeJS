import { defineStrategyPlugin } from '@tradejs/core/config';
import { type StrategyConfig } from '@tradejs/types';
import { adaptiveMomentumRibbonManifest } from './AdaptiveMomentumRibbon/manifest';
import { adaptiveTrendChannelManifest } from './AdaptiveTrendChannel/manifest';
import { breakoutManifest } from './Breakout/manifest';
import { marketFlushReversalManifest } from './MarketFlushReversal/manifest';
import { doubleTapManifest } from './DoubleTap/manifest';
import { gridManifest } from './Grid/manifest';
import { gridClassicManifest } from './GridClassic/manifest';
import { maStrategyManifest } from './MaStrategy/manifest';
import { relativeRotationManifest } from './RelativeRotation/manifest';
import { liquidityTailsManifest } from './LiquidityTails/manifest';
import { liquidityZonesManifest } from './LiquidityZones/manifest';
import { reverseTrendLineManifest } from './ReverseTrendLine/manifest';
import { structureZonesManifest } from './StructureZones/manifest';
import { trendFollowManifest } from './TrendFollow/manifest';
import { trendShiftManifest } from './TrendShift/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';
import { volatilityCompressionBreakoutManifest } from './VolatilityCompressionBreakout/manifest';
import { config as adaptiveMomentumRibbonDefaultConfig } from './AdaptiveMomentumRibbon/config';
import { AdaptiveMomentumRibbonStrategyCreator } from './AdaptiveMomentumRibbon/strategy';
import { config as adaptiveTrendChannelDefaultConfig } from './AdaptiveTrendChannel/config';
import { AdaptiveTrendChannelStrategyCreator } from './AdaptiveTrendChannel/strategy';
import { config as breakoutDefaultConfig } from './Breakout/config';
import { BreakoutStrategyCreator } from './Breakout/strategy';
import { config as marketFlushReversalDefaultConfig } from './MarketFlushReversal/config';
import { MarketFlushReversalStrategyCreator } from './MarketFlushReversal/strategy';
import { config as doubleTapDefaultConfig } from './DoubleTap/config';
import { DoubleTapStrategyCreator } from './DoubleTap/strategy';
import { config as gridDefaultConfig } from './Grid/config';
import { GridStrategyCreator } from './Grid/strategy';
import { config as gridClassicDefaultConfig } from './GridClassic/config';
import { GridClassicStrategyCreator } from './GridClassic/strategy';
import { config as maStrategyDefaultConfig } from './MaStrategy/config';
import { MaStrategyCreator } from './MaStrategy/strategy';
import { config as relativeRotationDefaultConfig } from './RelativeRotation/config';
import { RelativeRotationStrategyCreator } from './RelativeRotation/strategy';
import { config as liquidityTailsDefaultConfig } from './LiquidityTails/config';
import { LiquidityTailsStrategyCreator } from './LiquidityTails/strategy';
import { config as liquidityZonesDefaultConfig } from './LiquidityZones/config';
import { LiquidityZonesStrategyCreator } from './LiquidityZones/strategy';
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
import { config as volatilityCompressionBreakoutDefaultConfig } from './VolatilityCompressionBreakout/config';
import { VolatilityCompressionBreakoutStrategyCreator } from './VolatilityCompressionBreakout/strategy';
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
    manifest: marketFlushReversalManifest,
    creator: MarketFlushReversalStrategyCreator,
  },
  {
    manifest: volatilityCompressionBreakoutManifest,
    creator: VolatilityCompressionBreakoutStrategyCreator,
  },
  {
    manifest: relativeRotationManifest,
    creator: RelativeRotationStrategyCreator,
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
    manifest: gridManifest,
    creator: GridStrategyCreator,
  },
  {
    manifest: gridClassicManifest,
    creator: GridClassicStrategyCreator,
  },
  {
    manifest: liquidityTailsManifest,
    creator: LiquidityTailsStrategyCreator,
  },
  {
    manifest: liquidityZonesManifest,
    creator: LiquidityZonesStrategyCreator,
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
  MarketFlushReversal: marketFlushReversalDefaultConfig,
  VolatilityCompressionBreakout: volatilityCompressionBreakoutDefaultConfig,
  RelativeRotation: relativeRotationDefaultConfig,
  TrendShift: trendShiftDefaultConfig,
  DoubleTap: doubleTapDefaultConfig,
  Grid: gridDefaultConfig,
  GridClassic: gridClassicDefaultConfig,
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
export { marketFlushReversalDefaultConfig };
export { maStrategyDefaultConfig };
export { relativeRotationDefaultConfig };
export { trendLineDefaultConfig };
export { trendShiftDefaultConfig };
export { doubleTapDefaultConfig };
export { gridDefaultConfig };
export { gridClassicDefaultConfig };
export { liquidityTailsDefaultConfig };
export { liquidityZonesDefaultConfig };
export { trendFollowDefaultConfig };
export { structureZonesDefaultConfig };
export { reverseTrendLineDefaultConfig };
export { volumeDivergenceDefaultConfig };
export { volatilityCompressionBreakoutDefaultConfig };
export { adaptiveMomentumRibbonAiAdapter } from './AdaptiveMomentumRibbon/adapters/ai';
export { adaptiveMomentumRibbonMlAdapter } from './AdaptiveMomentumRibbon/adapters/ml';
export { adaptiveTrendChannelAiAdapter } from './AdaptiveTrendChannel/adapters/ai';
export { marketFlushReversalAiAdapter } from './MarketFlushReversal/adapters/ai';
export { maStrategyAiAdapter } from './MaStrategy/adapters/ai';
export { relativeRotationAiAdapter } from './RelativeRotation/adapters/ai';
export { maStrategyMlAdapter } from './MaStrategy/adapters/ml';
export { reverseTrendLineAiAdapter } from './ReverseTrendLine/adapters/ai';
export { trendShiftAiAdapter } from './TrendShift/adapters/ai';
export { doubleTapAiAdapter } from './DoubleTap/adapters/ai';
export { gridAiAdapter } from './Grid/adapters/ai';
export { gridClassicAiAdapter } from './GridClassic/adapters/ai';
export { liquidityTailsAiAdapter } from './LiquidityTails/adapters/ai';
export { liquidityZonesAiAdapter } from './LiquidityZones/adapters/ai';
export { structureZonesAiAdapter } from './StructureZones/adapters/ai';
export { trendFollowAiAdapter } from './TrendFollow/adapters/ai';
export { volumeDivergenceAiAdapter } from './VolumeDivergence/adapters/ai';
export { volumeDivergenceMlAdapter } from './VolumeDivergence/adapters/ml';
export { volatilityCompressionBreakoutAiAdapter } from './VolatilityCompressionBreakout/adapters/ai';

export default defineStrategyPlugin({ strategyEntries });
