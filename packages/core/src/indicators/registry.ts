import type {
  Indicator,
  IndicatorPluginEntry,
  IndicatorPluginRenderer,
} from '@types';

const warn = (message: string, ...args: unknown[]) => {
  console.warn(`[indicators] ${message}`, ...args);
};

const pluginIndicatorEntries = new Map<string, IndicatorPluginEntry>();

export const registerIndicatorEntries = (
  entries: readonly IndicatorPluginEntry[],
  source: string,
) => {
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

export const getRegisteredIndicatorEntries = (): IndicatorPluginEntry[] => [
  ...pluginIndicatorEntries.values(),
];

export const getPluginIndicatorCatalog = (): Indicator[] =>
  getRegisteredIndicatorEntries().map((entry) => ({
    id: entry.indicator.id,
    label: entry.indicator.label,
    enabled: entry.indicator.enabled,
    periods: entry.indicator.periods,
  }));

export type IndicatorRendererDescriptor = {
  indicatorId: string;
  renderer: IndicatorPluginRenderer;
};

export const getPluginIndicatorRenderers = (): IndicatorRendererDescriptor[] =>
  getRegisteredIndicatorEntries()
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
