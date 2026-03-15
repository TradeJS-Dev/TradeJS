import {
  getPluginIndicatorCatalog as getPluginIndicatorCatalogCore,
  getPluginIndicatorRenderers as getPluginIndicatorRenderersCore,
  getRegisteredIndicatorEntries as getRegisteredIndicatorEntriesCore,
  registerIndicatorEntries as registerIndicatorEntriesCore,
} from '@tradejs/core/indicators';
import {
  type IndicatorPluginEntry,
  type IndicatorPluginRenderer,
} from '@tradejs/types';

export const registerIndicatorEntries = (
  entries: readonly IndicatorPluginEntry[],
  source: string,
  scope?: string,
) => registerIndicatorEntriesCore(entries, source, scope);

export const getRegisteredIndicatorEntries = (scope?: string) =>
  getRegisteredIndicatorEntriesCore(scope);

export const getPluginIndicatorCatalog = (scope?: string) =>
  getPluginIndicatorCatalogCore(scope);

export type IndicatorRendererDescriptor = {
  indicatorId: string;
  renderer: IndicatorPluginRenderer;
};

export const getPluginIndicatorRenderers = (
  scope?: string,
): IndicatorRendererDescriptor[] => getPluginIndicatorRenderersCore(scope);
