import type {
  Indicator,
  IndicatorPluginEntry,
  IndicatorPluginRenderer,
} from '@tradejs/types';

const warn = (message: string, ...args: unknown[]) => {
  console.warn(`[core:indicators] ${message}`, ...args);
};

type IndicatorRegistryState = {
  pluginIndicatorEntries: Map<string, IndicatorPluginEntry>;
};

const DEFAULT_INDICATOR_REGISTRY_SCOPE = '__default__';
const registryStateByScope = new Map<string, IndicatorRegistryState>();

const normalizeScope = (scope?: string): string => {
  const normalized = String(scope ?? '').trim();
  return normalized || DEFAULT_INDICATOR_REGISTRY_SCOPE;
};

const getIndicatorRegistryState = (scope?: string): IndicatorRegistryState => {
  const normalizedScope = normalizeScope(scope);
  let state = registryStateByScope.get(normalizedScope);
  if (!state) {
    state = {
      pluginIndicatorEntries: new Map<string, IndicatorPluginEntry>(),
    };
    registryStateByScope.set(normalizedScope, state);
  }

  return state;
};

export const registerIndicatorEntries = (
  entries: readonly IndicatorPluginEntry[],
  source: string,
  scope?: string,
) => {
  const { pluginIndicatorEntries } = getIndicatorRegistryState(scope);
  for (const entry of entries) {
    const indicatorId = entry.indicator?.id;
    if (!indicatorId) {
      warn('Skip indicator entry without id from %s', source);
      continue;
    }

    if (pluginIndicatorEntries.has(indicatorId)) {
      warn(
        'Skip duplicate indicator "%s" from %s: already registered',
        indicatorId,
        source,
      );
      continue;
    }

    pluginIndicatorEntries.set(indicatorId, entry);
  }
};

export const getRegisteredIndicatorEntries = (
  scope?: string,
): IndicatorPluginEntry[] => [
  ...getIndicatorRegistryState(scope).pluginIndicatorEntries.values(),
];

export const getPluginIndicatorCatalog = (scope?: string): Indicator[] =>
  getRegisteredIndicatorEntries(scope).map((entry) => ({
    id: entry.indicator.id,
    label: entry.indicator.label,
    enabled: entry.indicator.enabled,
    periods: entry.indicator.periods,
  }));

export type IndicatorRendererDescriptor = {
  indicatorId: string;
  renderer: IndicatorPluginRenderer;
};

export const getPluginIndicatorRenderers = (
  scope?: string,
): IndicatorRendererDescriptor[] =>
  getRegisteredIndicatorEntries(scope)
    .filter(
      (
        entry,
      ): entry is IndicatorPluginEntry & {
        renderer: IndicatorPluginRenderer;
      } => Boolean(entry.renderer),
    )
    .map((entry) => ({
      indicatorId: entry.indicator.id,
      renderer: entry.renderer,
    }));

export const resetIndicatorRegistryCache = (scope?: string) => {
  const normalizedScope = String(scope ?? '').trim();
  if (!normalizedScope) {
    registryStateByScope.clear();
    return;
  }

  registryStateByScope.delete(normalizeScope(scope));
};
