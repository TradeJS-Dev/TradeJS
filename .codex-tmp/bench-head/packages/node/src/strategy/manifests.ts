import type {
  StrategyCreator,
  IndicatorPluginDefinition,
  IndicatorPluginEntry,
  StrategyManifest,
  StrategyPluginDefinition,
  StrategyRegistryEntry,
} from '@tradejs/types';
import {
  registerIndicatorEntries,
  resetIndicatorRegistryCache,
} from '@tradejs/core/indicators';
import { logger } from '@tradejs/infra/logger';
import {
  getTradejsProjectCwd,
  loadTradejsConfig,
  resolvePluginModuleSpecifier,
} from '../tradejsConfig';
import * as tradejsConfig from '../tradejsConfig';

type StrategyRegistryState = {
  strategyCreators: Map<string, StrategyCreator>;
  strategyManifestsMap: Map<string, StrategyManifest>;
  pluginsLoadPromise: Promise<void> | null;
};

const createStrategyRegistryState = (): StrategyRegistryState => ({
  strategyCreators: new Map<string, StrategyCreator>(),
  strategyManifestsMap: new Map<string, StrategyManifest>(),
  pluginsLoadPromise: null,
});

const registryStateByProjectRoot = new Map<string, StrategyRegistryState>();

const getStrategyRegistryState = (
  cwd = getTradejsProjectCwd(),
): {
  projectRoot: string;
  state: StrategyRegistryState;
} => {
  const projectRoot = getTradejsProjectCwd(cwd);
  let state = registryStateByProjectRoot.get(projectRoot);
  if (!state) {
    state = createStrategyRegistryState();
    registryStateByProjectRoot.set(projectRoot, state);
  }

  return {
    projectRoot,
    state,
  };
};

const toUniqueModules = (modules: string[] = []): string[] => [
  ...new Set(modules.map((moduleName) => moduleName.trim()).filter(Boolean)),
];

const getConfiguredPluginModuleNames = async (
  cwd = getTradejsProjectCwd(),
): Promise<{
  strategyModules: string[];
  indicatorModules: string[];
}> => {
  const config = await loadTradejsConfig(cwd);
  return {
    strategyModules: toUniqueModules(config.strategies),
    indicatorModules: toUniqueModules(config.indicators),
  };
};

const extractModuleEntries = <TEntry>(
  moduleExport: unknown,
  key: string,
): TEntry[] | null => {
  if (!moduleExport || typeof moduleExport !== 'object') {
    return null;
  }

  const candidate = moduleExport as Record<string, unknown>;
  if (Array.isArray(candidate[key])) {
    return candidate[key] as TEntry[];
  }

  const defaultExport = candidate.default as
    | Record<string, unknown>
    | undefined;
  if (defaultExport && Array.isArray(defaultExport[key])) {
    return defaultExport[key] as TEntry[];
  }

  return null;
};

const extractStrategyPluginDefinition = (
  moduleExport: unknown,
): StrategyPluginDefinition | null => {
  const strategyEntries = extractModuleEntries<StrategyRegistryEntry>(
    moduleExport,
    'strategyEntries',
  );
  return strategyEntries ? { strategyEntries } : null;
};

const extractIndicatorPluginDefinition = (
  moduleExport: unknown,
): IndicatorPluginDefinition | null => {
  const indicatorEntries = extractModuleEntries<IndicatorPluginEntry>(
    moduleExport,
    'indicatorEntries',
  );
  return indicatorEntries ? { indicatorEntries } : null;
};

const registerEntries = (
  entries: readonly StrategyRegistryEntry[],
  source: string,
  state: StrategyRegistryState,
) => {
  for (const entry of entries) {
    const strategyName = entry.manifest?.name;
    if (!strategyName) {
      logger.warn('Skip strategy entry without name from %s', source);
      continue;
    }
    if (state.strategyCreators.has(strategyName)) {
      logger.warn(
        'Skip duplicate strategy "%s" from %s: already registered',
        strategyName,
        source,
      );
      continue;
    }
    state.strategyCreators.set(strategyName, entry.creator);
    state.strategyManifestsMap.set(strategyName, entry.manifest);
  }
};

const importStrategyPluginModule = async (
  moduleName: string,
  cwd = getTradejsProjectCwd(),
): Promise<unknown> => {
  if (typeof tradejsConfig.importTradejsModule === 'function') {
    return tradejsConfig.importTradejsModule(moduleName, cwd);
  }
  return import(/* webpackIgnore: true */ moduleName);
};

export const ensureStrategyPluginsLoaded = async (
  cwd = getTradejsProjectCwd(),
): Promise<void> => {
  const { projectRoot, state } = getStrategyRegistryState(cwd);

  if (!state.pluginsLoadPromise) {
    resetIndicatorRegistryCache(projectRoot);

    state.pluginsLoadPromise = (async () => {
      const { strategyModules, indicatorModules } =
        await getConfiguredPluginModuleNames(projectRoot);

      const strategySet = new Set(strategyModules);
      const indicatorSet = new Set(indicatorModules);
      const pluginModuleNames = [
        ...new Set([...strategyModules, ...indicatorModules]),
      ];
      if (!pluginModuleNames.length) {
        return;
      }

      for (const moduleName of pluginModuleNames) {
        try {
          const resolvedModuleName = resolvePluginModuleSpecifier(
            moduleName,
            projectRoot,
          );
          const moduleExport = await importStrategyPluginModule(
            resolvedModuleName,
            projectRoot,
          );
          if (strategySet.has(moduleName)) {
            const pluginDefinition =
              extractStrategyPluginDefinition(moduleExport);
            if (!pluginDefinition) {
              logger.warn(
                'Skip strategy plugin "%s": export { strategyEntries } is missing',
                moduleName,
              );
            } else {
              registerEntries(
                pluginDefinition.strategyEntries,
                moduleName,
                state,
              );
            }
          }

          if (indicatorSet.has(moduleName)) {
            const indicatorPluginDefinition =
              extractIndicatorPluginDefinition(moduleExport);
            if (!indicatorPluginDefinition) {
              logger.warn(
                'Skip indicator plugin "%s": export { indicatorEntries } is missing',
                moduleName,
              );
            } else {
              registerIndicatorEntries(
                indicatorPluginDefinition.indicatorEntries,
                moduleName,
                projectRoot,
              );
            }
          }

          if (!strategySet.has(moduleName) && !indicatorSet.has(moduleName)) {
            logger.warn(
              'Skip plugin "%s": no strategy/indicator sections requested in config',
              moduleName,
            );
          }
        } catch (error) {
          logger.warn(
            'Failed to load plugin "%s": %s',
            moduleName,
            String(error),
          );
        }
      }
    })();
  }

  await state.pluginsLoadPromise;
};

export const ensureIndicatorPluginsLoaded = async (
  cwd = getTradejsProjectCwd(),
) => ensureStrategyPluginsLoaded(cwd);

export const getStrategyCreator = async (
  name: string,
  cwd = getTradejsProjectCwd(),
): Promise<StrategyCreator | undefined> => {
  await ensureStrategyPluginsLoaded(cwd);
  const { state } = getStrategyRegistryState(cwd);
  return state.strategyCreators.get(name);
};

export const getAvailableStrategyNames = async (
  cwd = getTradejsProjectCwd(),
): Promise<string[]> => {
  await ensureStrategyPluginsLoaded(cwd);
  const { state } = getStrategyRegistryState(cwd);
  return [...state.strategyCreators.keys()].sort((a, b) => a.localeCompare(b));
};

export const getRegisteredStrategies = (
  cwd = getTradejsProjectCwd(),
): Record<string, StrategyCreator> => {
  const { state } = getStrategyRegistryState(cwd);
  return Object.fromEntries(state.strategyCreators.entries());
};

export const getRegisteredManifests = (
  cwd = getTradejsProjectCwd(),
): StrategyManifest[] => {
  const { state } = getStrategyRegistryState(cwd);
  return [...state.strategyManifestsMap.values()];
};

export const getStrategyManifest = (
  name?: string,
  cwd = getTradejsProjectCwd(),
): StrategyManifest | undefined => {
  if (!name) {
    return undefined;
  }

  const { state } = getStrategyRegistryState(cwd);
  return state.strategyManifestsMap.get(name);
};

export const isKnownStrategy = (
  name: string,
  cwd = getTradejsProjectCwd(),
): boolean => {
  const { state } = getStrategyRegistryState(cwd);
  return state.strategyCreators.has(name);
};

export const registerStrategyEntries = (
  entries: readonly StrategyRegistryEntry[],
  cwd = getTradejsProjectCwd(),
) => {
  const { state } = getStrategyRegistryState(cwd);
  registerEntries(entries, 'runtime', state);
};

export const resetStrategyRegistryCache = (cwd?: string) => {
  const normalizedCwd = String(cwd ?? '').trim();
  if (!normalizedCwd) {
    registryStateByProjectRoot.clear();
    resetIndicatorRegistryCache();
    return;
  }

  const projectRoot = getTradejsProjectCwd(normalizedCwd);
  registryStateByProjectRoot.delete(projectRoot);
  resetIndicatorRegistryCache(projectRoot);
};

export const strategies = new Proxy(
  {},
  {
    get: (_target, property: string | symbol) => {
      if (typeof property !== 'string') {
        return undefined;
      }
      return getStrategyRegistryState().state.strategyCreators.get(property);
    },
    ownKeys: () => {
      return [...getStrategyRegistryState().state.strategyCreators.keys()];
    },
    getOwnPropertyDescriptor: () => ({
      enumerable: true,
      configurable: true,
    }),
  },
) as Record<string, StrategyCreator>;
