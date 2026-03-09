export * from './strategy';
export * from './types';
export * from './constants';

import type { IndicatorPluginDefinition, StrategyPluginDefinition } from './types';

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
