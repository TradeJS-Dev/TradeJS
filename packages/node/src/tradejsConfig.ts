import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  normalizeTradejsConfigHooks,
  type TradejsConfigHooks,
} from '@tradejs/core/config';
import { logger } from '@tradejs/infra/logger';
import type { TradejsRuntimeDeclaration } from '@tradejs/types';

export interface TradejsProjectConfig {
  strategies?: string[];
  indicators?: string[];
  connectors?: string[];
  hooks?: TradejsConfigHooks;
  runtime?: TradejsRuntimeDeclaration;
}

const CONFIG_FILE_NAMES = [
  'tradejs.config.ts',
  'tradejs.config.mts',
  'tradejs.config.js',
  'tradejs.config.mjs',
  'tradejs.config.cjs',
] as const;
const TS_MODULE_RE = /\.(cts|mts|ts)$/i;

let cachedByCwd = new Map<string, TradejsProjectConfig>();
let announcedConfigFile = new Set<string>();
let tsNodeRegistered = false;
let tsconfigPathsRegisteredByCwd = new Set<string>();
let tsconfigPathMatchersByCwd = new Map<
  string,
  (moduleName: string) => string
>();

export const getTradejsProjectCwd = (cwd?: string): string => {
  const explicit = String(cwd ?? '').trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const fromEnv = String(process.env.PROJECT_CWD || '').trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  return process.cwd();
};

const normalizeConfig = (rawConfig: unknown): TradejsProjectConfig => {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {};
  }

  const config = rawConfig as Record<string, unknown>;
  const strategies = Array.isArray(config.strategies)
    ? config.strategies
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];
  const indicators = Array.isArray(config.indicators)
    ? config.indicators
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];
  const connectors = Array.isArray(config.connectors)
    ? config.connectors
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];
  const hooks = normalizeTradejsConfigHooks(
    config.hooks as TradejsConfigHooks | undefined,
  );
  const runtime =
    config.runtime &&
    typeof config.runtime === 'object' &&
    !Array.isArray(config.runtime)
      ? (config.runtime as TradejsRuntimeDeclaration)
      : undefined;

  return {
    strategies,
    indicators,
    connectors,
    ...(hooks ? { hooks } : {}),
    ...(runtime ? { runtime } : {}),
  };
};

const getNodeCreateRequire = (): ((filename: string) => NodeJS.Require) => {
  const builtinModule = (
    process as typeof process & {
      getBuiltinModule?: (name: string) => unknown;
    }
  ).getBuiltinModule?.('module') as
    | {
        createRequire?: (filename: string) => NodeJS.Require;
      }
    | undefined;

  if (typeof builtinModule?.createRequire === 'function') {
    return builtinModule.createRequire;
  }

  throw new TypeError('module.createRequire is not available');
};

const getRequireFn = (cwd = getTradejsProjectCwd()): NodeJS.Require =>
  getNodeCreateRequire()(path.join(path.resolve(cwd), '__tradejs_loader__.js'));

const ensureTsNodeRegistered = async () => {
  if (tsNodeRegistered) {
    return;
  }

  const tsNodeModule = (await import('ts-node')) as {
    register?: (options?: Record<string, unknown>) => void;
    default?: {
      register?: (options?: Record<string, unknown>) => void;
    };
  };
  const tsNode = (tsNodeModule.default ?? tsNodeModule) as {
    register?: (options?: Record<string, unknown>) => void;
  };
  tsNode.register?.({
    transpileOnly: true,
    compilerOptions: {
      module: 'Node16',
      moduleResolution: 'node16',
    },
  });
  tsNodeRegistered = true;
};

const ensureTsconfigPathsRegistered = async (cwd = getTradejsProjectCwd()) => {
  const projectRoot = getTradejsProjectCwd(cwd);
  if (tsconfigPathsRegisteredByCwd.has(projectRoot)) {
    return;
  }

  const tsconfigPathsModule = (await import('tsconfig-paths')) as {
    loadConfig?: (cwd: string) =>
      | {
          resultType: 'success';
          absoluteBaseUrl: string;
          paths: Record<string, string[]>;
        }
      | {
          resultType: 'failed';
          message: string;
        };
    register?: (params: {
      baseUrl: string;
      paths: Record<string, string[]>;
      addMatchAll?: boolean;
    }) => void;
  };

  const loadConfig = tsconfigPathsModule.loadConfig;
  const register = tsconfigPathsModule.register;
  if (typeof loadConfig !== 'function' || typeof register !== 'function') {
    return;
  }

  const loadedConfig = loadConfig(projectRoot);
  if (loadedConfig.resultType !== 'success') {
    return;
  }

  register({
    baseUrl: loadedConfig.absoluteBaseUrl,
    paths: loadedConfig.paths,
    addMatchAll: false,
  });
  tsconfigPathsRegisteredByCwd.add(projectRoot);
};

const resolveTsconfigPathModule = async (
  moduleName: string,
  cwd = getTradejsProjectCwd(),
): Promise<string | null> => {
  const projectRoot = getTradejsProjectCwd(cwd);
  const cachedMatcher = tsconfigPathMatchersByCwd.get(projectRoot);
  if (cachedMatcher) {
    const resolved = cachedMatcher(moduleName);
    return resolved || null;
  }

  const tsconfigPathsModule = (await import('tsconfig-paths')) as {
    createMatchPath?: (
      absoluteBaseUrl: string,
      paths: Record<string, string[]>,
      mainFields?: readonly string[],
      addMatchAll?: boolean,
    ) => (
      requestedModule: string,
      readJson?: (path: string) => Record<string, unknown> | undefined,
      fileExists?: (path: string) => boolean,
      extensions?: readonly string[],
    ) => string | undefined;
    loadConfig?: (cwd: string) =>
      | {
          resultType: 'success';
          absoluteBaseUrl: string;
          paths: Record<string, string[]>;
        }
      | {
          resultType: 'failed';
          message: string;
        };
  };
  const loadConfig = tsconfigPathsModule.loadConfig;
  const createMatchPath = tsconfigPathsModule.createMatchPath;
  if (
    typeof loadConfig !== 'function' ||
    typeof createMatchPath !== 'function'
  ) {
    return null;
  }

  const loadedConfig = loadConfig(projectRoot);
  if (loadedConfig.resultType !== 'success') {
    return null;
  }

  const matchPath = createMatchPath(
    loadedConfig.absoluteBaseUrl,
    loadedConfig.paths,
  );
  const matcher = (requestedModule: string) =>
    matchPath(requestedModule, undefined, fs.existsSync, [
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.json',
    ]) || '';

  tsconfigPathMatchersByCwd.set(projectRoot, matcher);
  const resolved = matcher(moduleName);
  return resolved || null;
};

const toImportSpecifier = (moduleName: string): string => {
  if (moduleName.startsWith('file://')) {
    return moduleName;
  }

  if (path.isAbsolute(moduleName)) {
    return pathToFileURL(moduleName).href;
  }

  return moduleName;
};

const isTsModulePath = (moduleName: string): boolean =>
  TS_MODULE_RE.test(moduleName.split('?')[0]);

const isRelativeModulePath = (moduleName: string): boolean =>
  moduleName.startsWith('./') || moduleName.startsWith('../');

const isBareModuleSpecifier = (moduleName: string): boolean => {
  const normalized = String(moduleName ?? '').trim();
  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith('file://') ||
    path.isAbsolute(normalized) ||
    isRelativeModulePath(normalized)
  ) {
    return false;
  }

  return true;
};

const importConfigFile = async (configFilePath: string): Promise<unknown> => {
  const ext = path.extname(configFilePath).toLowerCase();
  const configFileUrl = `${toImportSpecifier(configFilePath)}?t=${Date.now()}`;

  if (ext === '.ts' || ext === '.mts') {
    const requireFn = getRequireFn(path.dirname(configFilePath));
    await ensureTsNodeRegistered();
    await ensureTsconfigPathsRegistered(path.dirname(configFilePath));
    return requireFn(configFilePath);
  }

  return import(/* webpackIgnore: true */ configFileUrl);
};

export const importTradejsModule = async (
  moduleName: string,
  cwd = getTradejsProjectCwd(),
): Promise<unknown> => {
  const normalized = String(moduleName ?? '').trim();
  if (!normalized) {
    return {};
  }

  let modulePath = normalized;
  if (normalized.startsWith('file://')) {
    try {
      modulePath = fileURLToPath(normalized);
    } catch {
      modulePath = normalized;
    }
  }

  const requireFn = getRequireFn(
    path.isAbsolute(modulePath) ? path.dirname(modulePath) : cwd,
  );

  if (isTsModulePath(modulePath)) {
    await ensureTsNodeRegistered();
    await ensureTsconfigPathsRegistered(cwd);
    return requireFn(modulePath);
  }

  if (isBareModuleSpecifier(normalized)) {
    await ensureTsconfigPathsRegistered(cwd);
    try {
      return requireFn(normalized);
    } catch (error) {
      const resolvedByTsconfig = await resolveTsconfigPathModule(
        normalized,
        cwd,
      );
      if (resolvedByTsconfig && resolvedByTsconfig !== normalized) {
        return requireFn(resolvedByTsconfig);
      }
      throw error;
    }
  }

  try {
    return await import(
      /* webpackIgnore: true */ toImportSpecifier(normalized)
    );
  } catch (error) {
    if (isTsModulePath(modulePath)) {
      await ensureTsNodeRegistered();
      await ensureTsconfigPathsRegistered(cwd);
      return requireFn(modulePath);
    }
    throw error;
  }
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
  let currentDir = path.resolve(cwd);

  while (true) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const fullPath = path.join(currentDir, fileName);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fullPath;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
};

export const resolvePluginModuleSpecifier = (
  moduleName: string,
  cwd = getTradejsProjectCwd(),
): string => {
  const normalized = String(moduleName ?? '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('file://')) {
    try {
      return fileURLToPath(normalized);
    } catch {
      return normalized;
    }
  }

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  if (isRelativeModulePath(normalized)) {
    return path.resolve(cwd, normalized);
  }

  return normalized;
};

export const loadTradejsConfig = async (
  cwd = getTradejsProjectCwd(),
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
      logger.log('debug', 'Loaded TradeJS config: %s', configFilePath);
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
  tsNodeRegistered = false;
  tsconfigPathsRegisteredByCwd = new Set<string>();
  tsconfigPathMatchersByCwd = new Map<string, (moduleName: string) => string>();
};
