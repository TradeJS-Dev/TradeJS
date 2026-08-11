import { defineStrategyPlugin } from '@tradejs/core/config';
import type { StrategyConfig, StrategyRegistryEntry } from '@tradejs/types';
import { config as adaptiveMomentumRibbonDefaultConfig } from './AdaptiveMomentumRibbon/config';
import { AdaptiveMomentumRibbonStrategyDefinition } from './AdaptiveMomentumRibbon/strategy';
import { config as adaptiveTrendChannelDefaultConfig } from './AdaptiveTrendChannel/config';
import { AdaptiveTrendChannelStrategyDefinition } from './AdaptiveTrendChannel/strategy';
import { config as breakoutDefaultConfig } from './Breakout/config';
import { BreakoutStrategyDefinition } from './Breakout/strategy';
import { config as cupAndHandleDefaultConfig } from './CupAndHandle/config';
import { CupAndHandleStrategyDefinition } from './CupAndHandle/strategy';
import { config as marketFlushReversalDefaultConfig } from './MarketFlushReversal/config';
import { MarketFlushReversalStrategyDefinition } from './MarketFlushReversal/strategy';
import { config as doubleTapDefaultConfig } from './DoubleTap/config';
import { DoubleTapStrategyDefinition } from './DoubleTap/strategy';
import { config as gridDefaultConfig } from './Grid/config';
import { GridStrategyDefinition } from './Grid/strategy';
import { config as gridClassicDefaultConfig } from './GridClassic/config';
import { GridClassicStrategyDefinition } from './GridClassic/strategy';
import { config as headAndShouldersDefaultConfig } from './HeadAndShoulders/config';
import { HeadAndShouldersStrategyDefinition } from './HeadAndShoulders/strategy';
import { config as hyperliquidConsensusDefaultConfig } from './HyperliquidConsensus/config';
import { HyperliquidConsensusStrategyDefinition } from './HyperliquidConsensus/strategy';
import { config as maStrategyDefaultConfig } from './MaStrategy/config';
import { MaStrategyDefinition } from './MaStrategy/strategy';
import { config as relativeRotationDefaultConfig } from './RelativeRotation/config';
import { RelativeRotationStrategyDefinition } from './RelativeRotation/strategy';
import { config as liquidityTailsDefaultConfig } from './LiquidityTails/config';
import { LiquidityTailsStrategyDefinition } from './LiquidityTails/strategy';
import { config as liquidityZonesDefaultConfig } from './LiquidityZones/config';
import { LiquidityZonesStrategyDefinition } from './LiquidityZones/strategy';
import { config as reverseTrendLineDefaultConfig } from './ReverseTrendLine/config';
import { ReverseTrendLineStrategyDefinition } from './ReverseTrendLine/strategy';
import { config as structureZonesDefaultConfig } from './StructureZones/config';
import { StructureZonesStrategyDefinition } from './StructureZones/strategy';
import { config as trendFollowDefaultConfig } from './TrendFollow/config';
import { TrendFollowStrategyDefinition } from './TrendFollow/strategy';
import { config as trendShiftDefaultConfig } from './TrendShift/config';
import { TrendShiftStrategyDefinition } from './TrendShift/strategy';
import { config as trendLineDefaultConfig } from './TrendLine/config';
import { TrendlineStrategyDefinition } from './TrendLine/strategy';
import { config as volumeDivergenceDefaultConfig } from './VolumeDivergence/config';
import { VolumeDivergenceStrategyDefinition } from './VolumeDivergence/strategy';
import { config as volatilityCompressionBreakoutDefaultConfig } from './VolatilityCompressionBreakout/config';
import { VolatilityCompressionBreakoutStrategyDefinition } from './VolatilityCompressionBreakout/strategy';

export const strategyEntries: StrategyRegistryEntry[] = [
  BreakoutStrategyDefinition,
  TrendlineStrategyDefinition,
  MarketFlushReversalStrategyDefinition,
  VolatilityCompressionBreakoutStrategyDefinition,
  RelativeRotationStrategyDefinition,
  TrendShiftStrategyDefinition,
  DoubleTapStrategyDefinition,
  HeadAndShouldersStrategyDefinition,
  CupAndHandleStrategyDefinition,
  GridStrategyDefinition,
  GridClassicStrategyDefinition,
  HyperliquidConsensusStrategyDefinition,
  LiquidityTailsStrategyDefinition,
  LiquidityZonesStrategyDefinition,
  TrendFollowStrategyDefinition,
  StructureZonesStrategyDefinition,
  ReverseTrendLineStrategyDefinition,
  MaStrategyDefinition,
  AdaptiveMomentumRibbonStrategyDefinition,
  AdaptiveTrendChannelStrategyDefinition,
  VolumeDivergenceStrategyDefinition,
];

const builtInStrategyDefaultConfigs: Record<string, StrategyConfig> = {
  Breakout: breakoutDefaultConfig,
  TrendLine: trendLineDefaultConfig,
  MarketFlushReversal: marketFlushReversalDefaultConfig,
  VolatilityCompressionBreakout: volatilityCompressionBreakoutDefaultConfig,
  RelativeRotation: relativeRotationDefaultConfig,
  TrendShift: trendShiftDefaultConfig,
  DoubleTap: doubleTapDefaultConfig,
  HeadAndShoulders: headAndShouldersDefaultConfig,
  CupAndHandle: cupAndHandleDefaultConfig,
  Grid: gridDefaultConfig,
  GridClassic: gridClassicDefaultConfig,
  HyperliquidConsensus: hyperliquidConsensusDefaultConfig,
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
export { headAndShouldersDefaultConfig };
export { cupAndHandleDefaultConfig };
export { gridDefaultConfig };
export { gridClassicDefaultConfig };
export { hyperliquidConsensusDefaultConfig };
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
export { hyperliquidConsensusAiAdapter } from './HyperliquidConsensus/adapters/ai';
export { marketFlushReversalAiAdapter } from './MarketFlushReversal/adapters/ai';
export { maStrategyAiAdapter } from './MaStrategy/adapters/ai';
export { relativeRotationAiAdapter } from './RelativeRotation/adapters/ai';
export { maStrategyMlAdapter } from './MaStrategy/adapters/ml';
export { reverseTrendLineAiAdapter } from './ReverseTrendLine/adapters/ai';
export { trendShiftAiAdapter } from './TrendShift/adapters/ai';
export { doubleTapAiAdapter } from './DoubleTap/adapters/ai';
export { headAndShouldersAiAdapter } from './HeadAndShoulders/adapters/ai';
export { cupAndHandleAiAdapter } from './CupAndHandle/adapters/ai';
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
