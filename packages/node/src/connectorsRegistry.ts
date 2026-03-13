import {
  ConnectorCreator,
  ConnectorPluginDefinition,
  ConnectorRegistryEntry,
} from '@tradejs/types';
import { logger } from '@tradejs/infra/logger';
import {
  loadTradejsConfig,
  resolvePluginModuleSpecifier,
} from './tradejsConfig';
import * as tradejsConfig from './tradejsConfig';

const connectorCreators = new Map<string, ConnectorCreator>();
const providerToConnectorName = new Map<string, string>();

let pluginsLoadPromise: Promise<void> | null = null;

export const BUILTIN_CONNECTOR_NAMES = {
  ByBit: 'ByBit',
  Binance: 'Binance',
  Coinbase: 'Coinbase',
  Test: 'Test',
} as const;

const normalizeProvider = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const toUniqueModules = (modules: string[] = []): string[] => [
  ...new Set(modules.map((moduleName) => moduleName.trim()).filter(Boolean)),
];

const findConnectorNameInsensitive = (name: string): string | null => {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const existingName of connectorCreators.keys()) {
    if (existingName.toLowerCase() === normalized) {
      return existingName;
    }
  }

  return null;
};

const normalizeProviders = (
  providers: unknown,
  connectorName: string,
): string[] => {
  const list = Array.isArray(providers)
    ? providers.map((item) => normalizeProvider(item)).filter(Boolean)
    : [];
  const deduped = [...new Set(list)];
  if (deduped.length) {
    return deduped;
  }
  return [normalizeProvider(connectorName)];
};

const registerProvider = (
  provider: string,
  connectorName: string,
  source: string,
) => {
  const existing = providerToConnectorName.get(provider);
  if (existing && existing !== connectorName) {
    logger.warn(
      'Skip duplicate connector provider "%s" from %s: already mapped to %s',
      provider,
      source,
      existing,
    );
    return;
  }

  providerToConnectorName.set(provider, connectorName);
};

const registerEntry = (entry: ConnectorRegistryEntry, source: string) => {
  const connectorName = String(entry?.name ?? '').trim();
  if (!connectorName) {
    logger.warn('Skip connector entry without name from %s', source);
    return;
  }

  if (typeof entry.creator !== 'function') {
    logger.warn(
      'Skip connector entry "%s" from %s: creator must be a function',
      connectorName,
      source,
    );
    return;
  }

  const existingByName = findConnectorNameInsensitive(connectorName);
  if (existingByName) {
    logger.warn(
      'Skip duplicate connector "%s" from %s: already registered as %s',
      connectorName,
      source,
      existingByName,
    );
    return;
  }

  connectorCreators.set(connectorName, entry.creator);
  const providers = normalizeProviders(entry.providers, connectorName);
  for (const provider of providers) {
    registerProvider(provider, connectorName, source);
  }
};

const registerEntries = (
  entries: readonly ConnectorRegistryEntry[],
  source: string,
) => {
  for (const entry of entries) {
    registerEntry(entry, source);
  }
};

const extractConnectorPluginDefinition = (
  moduleExport: unknown,
): ConnectorPluginDefinition | null => {
  if (!moduleExport || typeof moduleExport !== 'object') {
    return null;
  }

  const candidate = moduleExport as Record<string, unknown>;
  if (Array.isArray(candidate.connectorEntries)) {
    return {
      connectorEntries: candidate.connectorEntries as ConnectorRegistryEntry[],
    };
  }

  const defaultExport = candidate.default as
    | Record<string, unknown>
    | undefined;
  if (defaultExport && Array.isArray(defaultExport.connectorEntries)) {
    return {
      connectorEntries:
        defaultExport.connectorEntries as ConnectorRegistryEntry[],
    };
  }

  return null;
};

const importConnectorPluginModule = async (
  moduleName: string,
): Promise<unknown> => {
  if (typeof tradejsConfig.importTradejsModule === 'function') {
    return tradejsConfig.importTradejsModule(moduleName);
  }
  return import(/* webpackIgnore: true */ moduleName);
};

export const ensureConnectorPluginsLoaded = async (): Promise<void> => {
  if (pluginsLoadPromise) {
    return pluginsLoadPromise;
  }

  pluginsLoadPromise = (async () => {
    const config = await loadTradejsConfig();
    const connectorModules = toUniqueModules(config.connectors);
    if (!connectorModules.length) {
      return;
    }

    for (const moduleName of connectorModules) {
      try {
        const resolvedModuleName = resolvePluginModuleSpecifier(moduleName);
        const moduleExport =
          await importConnectorPluginModule(resolvedModuleName);
        const pluginDefinition = extractConnectorPluginDefinition(moduleExport);
        if (!pluginDefinition) {
          logger.warn(
            'Skip connector plugin "%s": export { connectorEntries } is missing',
            moduleName,
          );
          continue;
        }
        registerEntries(pluginDefinition.connectorEntries, moduleName);
      } catch (error) {
        logger.warn(
          'Failed to load connector plugin "%s": %s',
          moduleName,
          String(error),
        );
      }
    }
  })();

  return pluginsLoadPromise;
};

export const getConnectorCreatorByName = async (
  connectorName: unknown,
): Promise<ConnectorCreator | undefined> => {
  await ensureConnectorPluginsLoaded();
  const raw = String(connectorName ?? '').trim();
  if (!raw) {
    return undefined;
  }

  const direct = connectorCreators.get(raw);
  if (direct) {
    return direct;
  }

  const existing = findConnectorNameInsensitive(raw);
  if (!existing) {
    return undefined;
  }

  return connectorCreators.get(existing);
};

export const getConnectorNameByProvider = async (
  provider: unknown,
): Promise<string | undefined> => {
  await ensureConnectorPluginsLoaded();
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    return undefined;
  }
  return providerToConnectorName.get(normalized);
};

export const getConnectorCreatorByProvider = async (
  provider: unknown,
): Promise<ConnectorCreator | undefined> => {
  const connectorName = await getConnectorNameByProvider(provider);
  if (!connectorName) {
    return undefined;
  }
  return connectorCreators.get(connectorName);
};

export const resolveConnectorName = async (
  providerOrName: unknown,
): Promise<string | undefined> => {
  const raw = String(providerOrName ?? '').trim();
  if (!raw) {
    return undefined;
  }

  const byProvider = await getConnectorNameByProvider(raw);
  if (byProvider) {
    return byProvider;
  }

  const byName = await getConnectorCreatorByName(raw);
  if (!byName) {
    return undefined;
  }

  return findConnectorNameInsensitive(raw) ?? undefined;
};

export const getAvailableConnectorNames = async (): Promise<string[]> => {
  await ensureConnectorPluginsLoaded();
  return [...connectorCreators.keys()].sort((a, b) => a.localeCompare(b));
};

export const getAvailableConnectorProviders = async (): Promise<string[]> => {
  await ensureConnectorPluginsLoaded();
  return [...providerToConnectorName.keys()].sort((a, b) => a.localeCompare(b));
};

export const registerConnectorEntries = (
  entries: readonly ConnectorRegistryEntry[],
) => {
  registerEntries(entries, 'runtime');
};

export const resetConnectorRegistryCache = () => {
  connectorCreators.clear();
  providerToConnectorName.clear();
  pluginsLoadPromise = null;
};

export const DEFAULT_CONNECTOR_NAME = BUILTIN_CONNECTOR_NAMES.ByBit;
