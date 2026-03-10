export * from './strategy';
export * from './types';
export * from './constants';

import type {
  ConnectorPluginDefinition,
  IndicatorPluginDefinition,
  StrategyPluginDefinition,
} from './types';

export type PluginModuleSpecifier = string;

export interface TradejsConfig {
  // Supports npm module names and local module paths:
  // './plugins/x.ts', '../x.js', '/abs/path/x.mjs', 'file:///abs/path/x.mjs'
  strategyPlugins?: PluginModuleSpecifier[];
  indicatorsPlugins?: PluginModuleSpecifier[];
  connectorsPlugins?: PluginModuleSpecifier[];
}

export const defineConfig = <T extends TradejsConfig>(config: T): T => config;

export const defineStrategyPlugin = <T extends StrategyPluginDefinition>(
  plugin: T,
): T => plugin;

export const defineIndicatorPlugin = <T extends IndicatorPluginDefinition>(
  plugin: T,
): T => plugin;

export const defineConnectorPlugin = <T extends ConnectorPluginDefinition>(
  plugin: T,
): T => plugin;
