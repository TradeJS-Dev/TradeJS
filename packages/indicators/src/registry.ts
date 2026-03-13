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
) => registerIndicatorEntriesCore(entries, source);

export const getRegisteredIndicatorEntries = () =>
  getRegisteredIndicatorEntriesCore();

export const getPluginIndicatorCatalog = () => getPluginIndicatorCatalogCore();

export type IndicatorRendererDescriptor = {
  indicatorId: string;
  renderer: IndicatorPluginRenderer;
};

export const getPluginIndicatorRenderers = (): IndicatorRendererDescriptor[] =>
  getPluginIndicatorRenderersCore();
