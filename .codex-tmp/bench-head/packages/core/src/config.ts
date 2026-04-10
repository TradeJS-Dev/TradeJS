import type {
  ConnectorPluginDefinition,
  IndicatorPluginDefinition,
  StrategyPluginDefinition,
} from '@tradejs/types';

export type PluginModuleSpecifier = string;

export interface TradejsConfig {
  strategies?: PluginModuleSpecifier[];
  indicators?: PluginModuleSpecifier[];
  connectors?: PluginModuleSpecifier[];
}

const normalizePlugins = (
  values: PluginModuleSpecifier[] | undefined,
): PluginModuleSpecifier[] =>
  Array.isArray(values)
    ? values.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];

const mergePluginSpecifiers = (
  ...groups: Array<PluginModuleSpecifier[] | undefined>
): PluginModuleSpecifier[] => [
  ...new Set(groups.flatMap((group) => normalizePlugins(group))),
];

export function defineConfig(...configs: TradejsConfig[]): TradejsConfig {
  return {
    strategies: mergePluginSpecifiers(...configs.map((cfg) => cfg.strategies)),
    indicators: mergePluginSpecifiers(...configs.map((cfg) => cfg.indicators)),
    connectors: mergePluginSpecifiers(...configs.map((cfg) => cfg.connectors)),
  };
}

export const defineStrategyPlugin = <T extends StrategyPluginDefinition>(
  plugin: T,
): T => plugin;

export const defineIndicatorPlugin = <T extends IndicatorPluginDefinition>(
  plugin: T,
): T => plugin;

export const defineConnectorPlugin = <T extends ConnectorPluginDefinition>(
  plugin: T,
): T => plugin;
