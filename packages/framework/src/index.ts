import type { StrategyPluginDefinition } from '@tradejs/core/types';

export type {
  Strategy,
  StrategyCreator,
  StrategyCreatorParams,
  StrategyConfig,
  StrategyDecision,
  StrategyManifest,
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
}

export const defineConfig = <T extends TradejsConfig>(config: T): T => config;

export const defineStrategyPlugin = <T extends StrategyPluginDefinition>(
  plugin: T,
): T => plugin;
