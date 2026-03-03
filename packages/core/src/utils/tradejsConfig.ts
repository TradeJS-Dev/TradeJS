import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '@utils/logger';

export interface TradejsProjectConfig {
  strategyPlugins?: string[];
  indicatorsPlugins?: string[];
}

const CONFIG_FILE_NAMES = [
  'tradejs.config.ts',
  'tradejs.config.mts',
  'tradejs.config.js',
  'tradejs.config.mjs',
  'tradejs.config.cjs',
] as const;

let cachedByCwd = new Map<string, TradejsProjectConfig>();
let announcedConfigFile = new Set<string>();

const normalizeConfig = (rawConfig: unknown): TradejsProjectConfig => {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const config = rawConfig as Record<string, unknown>;
  const strategyPlugins = Array.isArray(config.strategyPlugins)
    ? config.strategyPlugins
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];
  const indicatorsPlugins = Array.isArray(config.indicatorsPlugins)
    ? config.indicatorsPlugins
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];

  return {
    strategyPlugins,
    indicatorsPlugins,
  };
};

const getRequireFn = (): NodeJS.Require | null => {
  try {
    // eslint-disable-next-line no-eval
    return eval('require') as NodeJS.Require;
  } catch {
    return null;
  }
};

const importConfigFile = async (configFilePath: string): Promise<unknown> => {
  const ext = path.extname(configFilePath).toLowerCase();
  const configFileUrl = `${pathToFileURL(configFilePath).href}?t=${Date.now()}`;

  if (ext === '.ts' || ext === '.mts') {
    const requireFn = getRequireFn();
    if (requireFn) {
      const tsNode = requireFn('ts-node') as {
        register?: (options?: Record<string, unknown>) => void;
      };
      tsNode.register?.({
        transpileOnly: true,
        compilerOptions: {
          module: 'commonjs',
          moduleResolution: 'node',
        },
      });
      return requireFn(configFilePath);
    }
  }

  return import(/* webpackIgnore: true */ configFileUrl);
};

const resolveExportedConfig = (
  moduleExports: unknown,
): TradejsProjectConfig => {
  const candidate =
    moduleExports &&
    typeof moduleExports === 'object' &&
    'default' in (moduleExports as Record<string, unknown>)
      ? (moduleExports as Record<string, unknown>).default
      : moduleExports;

  return normalizeConfig(candidate);
};

const findConfigFilePath = (cwd: string): string | null => {
  for (const fileName of CONFIG_FILE_NAMES) {
    const fullPath = path.join(cwd, fileName);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
  }
  return null;
};

export const loadTradejsConfig = async (
  cwd = process.cwd(),
): Promise<TradejsProjectConfig> => {
  const cached = cachedByCwd.get(cwd);
  if (cached) {
    return cached;
  }

  const configFilePath = findConfigFilePath(cwd);
  if (!configFilePath) {
    cachedByCwd.set(cwd, {});
    return {};
  }

  try {
    const moduleExports = await importConfigFile(configFilePath);
    const config = resolveExportedConfig(moduleExports);
    cachedByCwd.set(cwd, config);

    if (!announcedConfigFile.has(configFilePath)) {
      announcedConfigFile.add(configFilePath);
      logger.log('info', 'Loaded TradeJS config: %s', configFilePath);
    }

    return config;
  } catch (error) {
    logger.log(
      'warn',
      'Failed to load TradeJS config from %s: %s',
      configFilePath,
      String(error),
    );
    cachedByCwd.set(cwd, {});
    return {};
  }
};

export const resetTradejsConfigCache = (): void => {
  cachedByCwd = new Map<string, TradejsProjectConfig>();
  announcedConfigFile = new Set<string>();
};
