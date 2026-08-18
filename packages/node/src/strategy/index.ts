import { createStrategyRuntime } from '../strategyRuntime';
import { setStrategyRuntimeFactory } from './manifests';

setStrategyRuntimeFactory(createStrategyRuntime);

export {
  ensureStrategyPluginsLoaded,
  ensureIndicatorPluginsLoaded,
  getAvailableStrategyNames,
  getRegisteredStrategies,
  getRegisteredManifests,
  registerStrategyEntries,
  getStrategyDefaults,
  getStrategyPluginSource,
  getStrategyCreator,
  resetStrategyRegistryCache,
  strategies,
  getStrategyManifest,
  isKnownStrategy,
} from './manifests';
