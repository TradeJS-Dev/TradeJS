import type { Indicator, IndicatorPluginEntry } from '@types';
import { logger } from '@utils/logger';

const pluginIndicatorEntries = new Map<string, IndicatorPluginEntry>();

export const registerIndicatorEntries = (
  entries: readonly IndicatorPluginEntry[],
  source: string,
) => {
  for (const entry of entries) {
    const indicatorId = entry.indicator?.id;
    if (!indicatorId) {
      logger.warn('Skip indicator entry without id from %s', source);
      continue;
    }

    if (pluginIndicatorEntries.has(indicatorId)) {
      logger.warn(
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
