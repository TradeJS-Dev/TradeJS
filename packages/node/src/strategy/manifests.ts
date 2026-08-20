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
import {
  getTradejsProjectCwd,
  loadTradejsConfig,
  resolvePluginModuleSpecifier,
} from '../tradejsConfig';
import * as tradejsConfig from '../tradejsConfig';

type StrategyRegistryState = {
  strategyCreators: Map<string, StrategyCreator>;
  strategyManifestsMap: Map<string, StrategyManifest>;
  strategyEntriesMap: Map<string, StrategyRegistryEntry>;
  strategySourcesMap: Map<string, string>;
  pluginsLoadPromise: Promise<void> | null;
};

type StrategyRuntimeFactory = (params: {
  strategyName: string;
  defaults: StrategyRegistryEntry['defaults'];
  createCore: StrategyRegistryEntry['createCore'];
  manifest: StrategyManifest;
  detectorKey?: StrategyRegistryEntry['detectorKey'];
  detectorNoSignalSkipReason?: string;
  resolveRegisteredManifest: (name: string) => StrategyManifest | undefined;
}) => StrategyCreator;

type SharedStrategyRegistryState = {
  registryStateByProjectRoot: Map<string, StrategyRegistryState>;
  strategyRuntimeFactory?: StrategyRuntimeFactory;
};

const SHARED_STRATEGY_REGISTRY_KEY =
  '__tradejsNodeSharedStrategyRegistryV1__' as const;

const sharedRegistryScope = globalThis as typeof globalThis & {
  [SHARED_STRATEGY_REGISTRY_KEY]?: SharedStrategyRegistryState;
};

const sharedStrategyRegistry: SharedStrategyRegistryState =
  sharedRegistryScope[SHARED_STRATEGY_REGISTRY_KEY] ??
  (sharedRegistryScope[SHARED_STRATEGY_REGISTRY_KEY] = {
    registryStateByProjectRoot: new Map<string, StrategyRegistryState>(),
  });

const createStrategyRegistryState = (): StrategyRegistryState => ({
  strategyCreators: new Map<string, StrategyCreator>(),
  strategyManifestsMap: new Map<string, StrategyManifest>(),
  strategyEntriesMap: new Map<string, StrategyRegistryEntry>(),
  strategySourcesMap: new Map<string, string>(),
  pluginsLoadPromise: null,
});

const registryStateByProjectRoot =
  sharedStrategyRegistry.registryStateByProjectRoot;

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

const validateStrategyEntries = (
  moduleName: string,
  entries: readonly StrategyRegistryEntry[],
  state: StrategyRegistryState,
) => {
  const issues: string[] = [];
  const names = new Set<string>();
  entries.forEach((entry, index) => {
    const entryPath = `${moduleName}.strategyEntries[${index}]`;
    const strategyName = entry?.manifest?.name;
    if (typeof strategyName !== 'string' || !strategyName.trim()) {
      issues.push(`${entryPath}: manifest.name is required`);
    } else if (
      names.has(strategyName) ||
      state.strategyEntriesMap.has(strategyName)
    ) {
      issues.push(`${entryPath}: duplicate strategy ${strategyName}`);
    } else {
      names.add(strategyName);
    }
    if (
      !entry ||
      typeof entry !== 'object' ||
      !entry.defaults ||
      typeof entry.defaults !== 'object' ||
      Array.isArray(entry.defaults)
    ) {
      issues.push(`${entryPath}: defaults must be an object`);
    }
    if (typeof entry?.parseConfig !== 'function') {
      issues.push(`${entryPath}: parseConfig is required`);
    }
    if (typeof entry?.createCore !== 'function') {
      issues.push(`${entryPath}: createCore is required`);
    }
  });
  return issues;
};

const registerEntries = (
  entries: readonly StrategyRegistryEntry[],
  source: string,
  state: StrategyRegistryState,
) => {
  for (const entry of entries) {
    const strategyName = entry.manifest.name;
    state.strategyManifestsMap.set(strategyName, entry.manifest);
    state.strategyEntriesMap.set(strategyName, entry);
    state.strategySourcesMap.set(strategyName, source);
    materializeStrategyCreator(strategyName, state);
  }
};

const materializeStrategyCreator = (
  strategyName: string,
  state: StrategyRegistryState,
) => {
  if (
    state.strategyCreators.has(strategyName) ||
    !sharedStrategyRegistry.strategyRuntimeFactory
  ) {
    return;
  }

  const entry = state.strategyEntriesMap.get(strategyName);
  if (!entry) return;

  state.strategyCreators.set(
    strategyName,
    sharedStrategyRegistry.strategyRuntimeFactory({
      strategyName,
      defaults: entry.defaults,
      createCore: entry.createCore,
      manifest: entry.manifest,
      detectorKey: entry.detectorKey,
      detectorNoSignalSkipReason: entry.detectorNoSignalSkipReason,
      resolveRegisteredManifest: (name) => state.strategyManifestsMap.get(name),
    }),
  );
};

export const setStrategyRuntimeFactory = (factory: StrategyRuntimeFactory) => {
  sharedStrategyRegistry.strategyRuntimeFactory = factory;
  for (const state of registryStateByProjectRoot.values()) {
    for (const strategyName of state.strategyEntriesMap.keys()) {
      materializeStrategyCreator(strategyName, state);
    }
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

      const issues: string[] = [];
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
              issues.push(
                `${moduleName}: export { strategyEntries } is missing`,
              );
            } else {
              const entryIssues = validateStrategyEntries(
                moduleName,
                pluginDefinition.strategyEntries,
                state,
              );
              issues.push(...entryIssues);
              if (entryIssues.length === 0) {
                registerEntries(
                  pluginDefinition.strategyEntries,
                  moduleName,
                  state,
                );
              }
            }
          }

          if (indicatorSet.has(moduleName)) {
            const indicatorPluginDefinition =
              extractIndicatorPluginDefinition(moduleExport);
            if (!indicatorPluginDefinition) {
              issues.push(
                `${moduleName}: export { indicatorEntries } is missing`,
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
            issues.push(`${moduleName}: plugin is not declared in config`);
          }
        } catch (error) {
          issues.push(`${moduleName}: failed to import: ${String(error)}`);
        }
      }
      if (issues.length > 0) {
        throw new Error(
          ['Invalid TradeJS plugin catalog:', ...issues].join('\n'),
        );
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

export const getStrategyDefaults = async (
  name: string,
  cwd = getTradejsProjectCwd(),
): Promise<StrategyRegistryEntry['defaults'] | undefined> => {
  await ensureStrategyPluginsLoaded(cwd);
  const { state } = getStrategyRegistryState(cwd);
  return state.strategyEntriesMap.get(name)?.defaults;
};

export const getStrategyEntry = async (
  name: string,
  cwd = getTradejsProjectCwd(),
): Promise<StrategyRegistryEntry | undefined> => {
  await ensureStrategyPluginsLoaded(cwd);
  const { state } = getStrategyRegistryState(cwd);
  return state.strategyEntriesMap.get(name);
};

export const getStrategyPluginSource = async (
  name: string,
  cwd = getTradejsProjectCwd(),
): Promise<string | undefined> => {
  await ensureStrategyPluginsLoaded(cwd);
  const { state } = getStrategyRegistryState(cwd);
  return state.strategySourcesMap.get(name);
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
  const issues = validateStrategyEntries('runtime', entries, state);
  if (issues.length > 0) {
    throw new Error(['Invalid TradeJS plugin catalog:', ...issues].join('\n'));
  }
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
