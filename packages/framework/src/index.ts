import type { StrategyPluginDefinition } from '@tradejs/core/types';
import type { IndicatorPluginDefinition } from '@tradejs/core/types';

export type {
  Strategy,
  StrategyCreator,
  StrategyCreatorParams,
  StrategyConfig,
  StrategyDecision,
  StrategyManifest,
  IndicatorPluginEntry,
  IndicatorPluginDefinition,
  IndicatorPluginComputeParams,
  IndicatorPluginRenderer,
  IndicatorPluginFigureRenderer,
  StrategyRegistryEntry,
  StrategyPluginDefinition,
  CreateStrategyCore,
  StrategyAPI,
  Signal,
  Candle,
  Interval,
  Direction,
} from '@tradejs/core/types';

export interface TradejsConfig {
  strategyPlugins?: string[];
  indicatorsPlugins?: string[];
}

export const defineConfig = <T extends TradejsConfig>(config: T): T => config;

export const defineStrategyPlugin = <T extends StrategyPluginDefinition>(
  plugin: T,
): T => plugin;

export const defineIndicatorPlugin = <T extends IndicatorPluginDefinition>(
  plugin: T,
): T => plugin;

export { asPositiveInt, asPositiveNumber } from '@tradejs/core/utils/number';
