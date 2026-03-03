import type {
  StrategyCreator,
  IndicatorPluginDefinition,
  StrategyManifest,
  StrategyPluginDefinition,
  StrategyRegistryEntry,
} from '@types';
import { registerIndicatorEntries } from '@tradejs/core/indicators';
import { logger } from '@utils/logger';
import { loadTradejsConfig } from '@utils/tradejsConfig';
import { breakoutManifest } from './Breakout/manifest';
import { trendLineManifest } from './TrendLine/manifest';
import { volumeDivergenceManifest } from './VolumeDivergence/manifest';

const createLazyStrategyCreator = <TModule extends Record<string, unknown>>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule,
): StrategyCreator => {
  return async (params) => {
    const module = await loader();
    const creator = module[exportName];
    if (typeof creator !== 'function') {
      throw new Error(
        `Strategy creator export "${String(exportName)}" is missing`,
      );
    }
    return (creator as StrategyCreator)(params);
  };
};

const builtInStrategyEntries: readonly StrategyRegistryEntry[] = [
  {
    manifest: breakoutManifest,
    creator: createLazyStrategyCreator(
      () => import('./Breakout/strategy'),
      'BreakoutStrategyCreator',
    ),
  },
  {
    manifest: trendLineManifest,
    creator: createLazyStrategyCreator(
      () => import('./TrendLine/strategy'),
      'TrendlineStrategyCreator',
    ),
  },
  {
    manifest: volumeDivergenceManifest,
    creator: createLazyStrategyCreator(
      () => import('./VolumeDivergence/strategy'),
      'VolumeDivergenceStrategyCreator',
    ),
  },
] as const;

const strategyCreators = new Map<string, StrategyCreator>();
const strategyManifestsMap = new Map<string, StrategyManifest>();

let registryBootstrapped = false;
let pluginsLoadPromise: Promise<void> | null = null;

const parseStrategyPluginModuleNames = async (): Promise<string[]> => {
  const config = await loadTradejsConfig();
  const fromConfig = config.strategyPlugins || [];
  return [...new Set(fromConfig)];
};

const parseIndicatorPluginModuleNames = async (): Promise<string[]> => {
  const config = await loadTradejsConfig();
  const fromConfig = config.indicatorsPlugins || [];
  return [...new Set(fromConfig)];
};

const extractPluginDefinition = (
  moduleExport: unknown,
): StrategyPluginDefinition | null => {
  if (!moduleExport || typeof moduleExport !== 'object') {
    return null;
  }

  const candidate = moduleExport as Record<string, unknown>;

  if (Array.isArray(candidate.strategyEntries)) {
    return {
      strategyEntries: candidate.strategyEntries as StrategyRegistryEntry[],
    };
  }

  const defaultExport = candidate.default as
    | Record<string, unknown>
    | undefined;
  if (defaultExport && Array.isArray(defaultExport.strategyEntries)) {
    return {
      strategyEntries: defaultExport.strategyEntries as StrategyRegistryEntry[],
    };
  }

  return null;
};

const extractIndicatorPluginDefinition = (
  moduleExport: unknown,
): IndicatorPluginDefinition | null => {
  if (!moduleExport || typeof moduleExport !== 'object') {
    return null;
  }

  const candidate = moduleExport as Record<string, unknown>;

  if (Array.isArray(candidate.indicatorEntries)) {
    return {
      indicatorEntries:
        candidate.indicatorEntries as IndicatorPluginDefinition['indicatorEntries'],
    };
  }

  const defaultExport = candidate.default as
    | Record<string, unknown>
    | undefined;
  if (defaultExport && Array.isArray(defaultExport.indicatorEntries)) {
    return {
      indicatorEntries:
        defaultExport.indicatorEntries as IndicatorPluginDefinition['indicatorEntries'],
    };
  }

  return null;
};

const registerEntries = (
  entries: readonly StrategyRegistryEntry[],
  source: string,
) => {
  for (const entry of entries) {
    const strategyName = entry.manifest?.name;
    if (!strategyName) {
      logger.warn('Skip strategy entry without name from %s', source);
      continue;
    }
    if (strategyCreators.has(strategyName)) {
      logger.warn(
        'Skip duplicate strategy "%s" from %s: already registered',
        strategyName,
        source,
      );
      continue;
    }
    strategyCreators.set(strategyName, entry.creator);
    strategyManifestsMap.set(strategyName, entry.manifest);
  }
};

const bootstrapBuiltInEntries = () => {
  if (registryBootstrapped) return;
  registerEntries(builtInStrategyEntries, 'built-in');
  registryBootstrapped = true;
};

const importStrategyPluginModule = async (
  moduleName: string,
): Promise<unknown> => {
  return import(/* webpackIgnore: true */ moduleName);
};

export const ensureStrategyPluginsLoaded = async (): Promise<void> => {
  bootstrapBuiltInEntries();

  if (pluginsLoadPromise) {
    return pluginsLoadPromise;
  }

  pluginsLoadPromise = (async () => {
    const [strategyPluginModuleNames, indicatorPluginModuleNames] =
      await Promise.all([
        parseStrategyPluginModuleNames(),
        parseIndicatorPluginModuleNames(),
      ]);

    const strategySet = new Set(strategyPluginModuleNames);
    const indicatorSet = new Set(indicatorPluginModuleNames);
    const pluginModuleNames = [
      ...new Set([...strategyPluginModuleNames, ...indicatorPluginModuleNames]),
    ];
    if (!pluginModuleNames.length) return;

    for (const moduleName of pluginModuleNames) {
      try {
        const moduleExport = await importStrategyPluginModule(moduleName);
        if (strategySet.has(moduleName)) {
          const pluginDefinition = extractPluginDefinition(moduleExport);
          if (!pluginDefinition) {
            logger.warn(
              'Skip strategy plugin "%s": export { strategyEntries } is missing',
              moduleName,
            );
          } else {
            registerEntries(pluginDefinition.strategyEntries, moduleName);
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

  return pluginsLoadPromise;
};

export const ensureIndicatorPluginsLoaded = ensureStrategyPluginsLoaded;

export const getStrategyCreator = async (
  name: string,
): Promise<StrategyCreator | undefined> => {
  await ensureStrategyPluginsLoaded();
  return strategyCreators.get(name);
};

export const getAvailableStrategyNames = async (): Promise<string[]> => {
  await ensureStrategyPluginsLoaded();
  return [...strategyCreators.keys()].sort((a, b) => a.localeCompare(b));
};

export const getRegisteredStrategies = (): Record<string, StrategyCreator> => {
  bootstrapBuiltInEntries();
  return Object.fromEntries(strategyCreators.entries());
};

export const getRegisteredManifests = (): StrategyManifest[] => {
  bootstrapBuiltInEntries();
  return [...strategyManifestsMap.values()];
};

export const getStrategyManifest = (
  name?: string,
): StrategyManifest | undefined => {
  bootstrapBuiltInEntries();
  return name ? strategyManifestsMap.get(name) : undefined;
};

export const isKnownStrategy = (name: string): boolean => {
  bootstrapBuiltInEntries();
  return strategyCreators.has(name);
};

export const registerStrategyEntries = (
  entries: readonly StrategyRegistryEntry[],
) => {
  bootstrapBuiltInEntries();
  registerEntries(entries, 'runtime');
};

export const strategies = new Proxy(
  {},
  {
    get: (_target, property: string | symbol) => {
      bootstrapBuiltInEntries();
      if (typeof property !== 'string') {
        return undefined;
      }
      return strategyCreators.get(property);
    },
    ownKeys: () => {
      bootstrapBuiltInEntries();
      return [...strategyCreators.keys()];
    },
    getOwnPropertyDescriptor: () => ({
      enumerable: true,
      configurable: true,
    }),
  },
) as Record<string, StrategyCreator>;

bootstrapBuiltInEntries();

export const strategyManifests: StrategyManifest[] = getRegisteredManifests();
export const strategyNames: string[] = [...strategyCreators.keys()];
