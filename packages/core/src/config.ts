import type {
  ConnectorPluginDefinition,
  IndicatorPluginDefinition,
  StrategyDecision,
  StrategyHookBarContext,
  StrategyHookAfterDecisionContext,
  StrategyManifest,
  StrategyPluginDefinition,
} from '@tradejs/types';

export type PluginModuleSpecifier = string;

type StrategyManifestHooks = NonNullable<StrategyManifest['hooks']>;
type HookOrHooks<THook> = THook | THook[];

export type TradejsConfigAfterCoreDecisionHook = (
  params: StrategyHookAfterDecisionContext,
) => Promise<StrategyDecision | void> | StrategyDecision | void;

export type TradejsConfigAfterBarDecisionHook = (
  params: StrategyHookAfterDecisionContext,
) => Promise<StrategyDecision | void> | StrategyDecision | void;

export type TradejsConfigOnBarHook = (
  params: StrategyHookBarContext,
) => Promise<StrategyDecision | void> | StrategyDecision | void;

export interface TradejsConfigHooks {
  onInit?: HookOrHooks<NonNullable<StrategyManifestHooks['onInit']>>;
  onBar?: HookOrHooks<TradejsConfigOnBarHook>;
  afterCoreDecision?: HookOrHooks<TradejsConfigAfterCoreDecisionHook>;
  afterBarDecision?: HookOrHooks<TradejsConfigAfterBarDecisionHook>;
  onSkip?: HookOrHooks<NonNullable<StrategyManifestHooks['onSkip']>>;
  beforeClosePosition?: HookOrHooks<
    NonNullable<StrategyManifestHooks['beforeClosePosition']>
  >;
  afterEnrichMl?: HookOrHooks<
    NonNullable<StrategyManifestHooks['afterEnrichMl']>
  >;
  afterEnrichAi?: HookOrHooks<
    NonNullable<StrategyManifestHooks['afterEnrichAi']>
  >;
  beforeEntryGate?: HookOrHooks<
    NonNullable<StrategyManifestHooks['beforeEntryGate']>
  >;
  beforePlaceOrder?: HookOrHooks<
    NonNullable<StrategyManifestHooks['beforePlaceOrder']>
  >;
  afterPlaceOrder?: HookOrHooks<
    NonNullable<StrategyManifestHooks['afterPlaceOrder']>
  >;
  onRuntimeError?: HookOrHooks<
    NonNullable<StrategyManifestHooks['onRuntimeError']>
  >;
}

export interface TradejsConfig {
  strategies?: PluginModuleSpecifier[];
  indicators?: PluginModuleSpecifier[];
  connectors?: PluginModuleSpecifier[];
  hooks?: TradejsConfigHooks;
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

const normalizeHookList = <THook extends (...args: any[]) => unknown>(
  value: HookOrHooks<THook> | undefined,
): THook[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is THook => typeof item === 'function');
  }

  return typeof value === 'function' ? [value] : [];
};

const mergeHookLists = <THook extends (...args: any[]) => unknown>(
  ...groups: Array<HookOrHooks<THook> | undefined>
): THook[] => [...new Set(groups.flatMap((group) => normalizeHookList(group)))];

const setMergedHook = <K extends keyof TradejsConfigHooks>(
  key: K,
  groups: Array<TradejsConfigHooks | undefined>,
  target: TradejsConfigHooks,
) => {
  const merged = mergeHookLists(...groups.map((group) => group?.[key] as any));
  if (merged.length > 0) {
    target[key] = merged as TradejsConfigHooks[K];
  }
};

export const mergeTradejsConfigHooks = (
  ...groups: Array<TradejsConfigHooks | undefined>
): TradejsConfigHooks | undefined => {
  const hooks: TradejsConfigHooks = {};

  setMergedHook('onInit', groups, hooks);
  setMergedHook('onBar', groups, hooks);
  setMergedHook('afterCoreDecision', groups, hooks);
  setMergedHook('afterBarDecision', groups, hooks);
  setMergedHook('onSkip', groups, hooks);
  setMergedHook('beforeClosePosition', groups, hooks);
  setMergedHook('afterEnrichMl', groups, hooks);
  setMergedHook('afterEnrichAi', groups, hooks);
  setMergedHook('beforeEntryGate', groups, hooks);
  setMergedHook('beforePlaceOrder', groups, hooks);
  setMergedHook('afterPlaceOrder', groups, hooks);
  setMergedHook('onRuntimeError', groups, hooks);

  return Object.keys(hooks).length > 0 ? hooks : undefined;
};

export const normalizeTradejsConfigHooks = (
  hooks?: TradejsConfigHooks,
): TradejsConfigHooks | undefined => mergeTradejsConfigHooks(hooks);

export function defineConfig(...configs: TradejsConfig[]): TradejsConfig {
  return {
    strategies: mergePluginSpecifiers(...configs.map((cfg) => cfg.strategies)),
    indicators: mergePluginSpecifiers(...configs.map((cfg) => cfg.indicators)),
    connectors: mergePluginSpecifiers(...configs.map((cfg) => cfg.connectors)),
    hooks: mergeTradejsConfigHooks(...configs.map((cfg) => cfg.hooks)),
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
