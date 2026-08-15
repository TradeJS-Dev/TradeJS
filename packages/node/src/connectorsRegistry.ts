import {
  ConnectorCreator,
  ConnectorPluginDefinition,
  ConnectorRegistryEntry,
} from '@tradejs/types';
import { logger } from '@tradejs/infra/logger';
import {
  getTradejsProjectCwd,
  loadTradejsConfig,
  resolvePluginModuleSpecifier,
} from './tradejsConfig';
import * as tradejsConfig from './tradejsConfig';
import { bindConnectorRuntime } from './connectorRuntime';

type ConnectorRegistryState = {
  connectorCreators: Map<string, ConnectorCreator>;
  providerToConnectorName: Map<string, string>;
  pluginsLoadPromise: Promise<void> | null;
};

const createConnectorRegistryState = (): ConnectorRegistryState => ({
  connectorCreators: new Map<string, ConnectorCreator>(),
  providerToConnectorName: new Map<string, string>(),
  pluginsLoadPromise: null,
});

const registryStateByProjectRoot = new Map<string, ConnectorRegistryState>();

const getConnectorRegistryState = (
  cwd = getTradejsProjectCwd(),
): {
  projectRoot: string;
  state: ConnectorRegistryState;
} => {
  const projectRoot = getTradejsProjectCwd(cwd);
  let state = registryStateByProjectRoot.get(projectRoot);
  if (!state) {
    state = createConnectorRegistryState();
    registryStateByProjectRoot.set(projectRoot, state);
  }

  return {
    projectRoot,
    state,
  };
};

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

const findConnectorNameInsensitive = (
  name: string,
  connectorCreators: ReadonlyMap<string, ConnectorCreator>,
): string | null => {
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
  providerToConnectorName: Map<string, string>,
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

const registerEntry = (
  entry: ConnectorRegistryEntry,
  source: string,
  state: ConnectorRegistryState,
) => {
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

  const existingByName = findConnectorNameInsensitive(
    connectorName,
    state.connectorCreators,
  );
  if (existingByName) {
    logger.warn(
      'Skip duplicate connector "%s" from %s: already registered as %s',
      connectorName,
      source,
      existingByName,
    );
    return;
  }

  state.connectorCreators.set(
    connectorName,
    bindConnectorRuntime(entry.creator),
  );
  const providers = normalizeProviders(entry.providers, connectorName);
  for (const provider of providers) {
    registerProvider(
      provider,
      connectorName,
      source,
      state.providerToConnectorName,
    );
  }
};

const registerEntries = (
  entries: readonly ConnectorRegistryEntry[],
  source: string,
  state: ConnectorRegistryState,
) => {
  for (const entry of entries) {
    registerEntry(entry, source, state);
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
  cwd = getTradejsProjectCwd(),
): Promise<unknown> => {
  if (typeof tradejsConfig.importTradejsModule === 'function') {
    return tradejsConfig.importTradejsModule(moduleName, cwd);
  }
  return import(/* webpackIgnore: true */ moduleName);
};

export const ensureConnectorPluginsLoaded = async (
  cwd = getTradejsProjectCwd(),
): Promise<void> => {
  const { projectRoot, state } = getConnectorRegistryState(cwd);

  if (!state.pluginsLoadPromise) {
    state.pluginsLoadPromise = (async () => {
      const config = await loadTradejsConfig(projectRoot);
      const connectorModules = toUniqueModules(config.connectors);
      if (!connectorModules.length) {
        return;
      }

      for (const moduleName of connectorModules) {
        try {
          const resolvedModuleName = resolvePluginModuleSpecifier(
            moduleName,
            projectRoot,
          );
          const moduleExport = await importConnectorPluginModule(
            resolvedModuleName,
            projectRoot,
          );
          const pluginDefinition =
            extractConnectorPluginDefinition(moduleExport);
          if (!pluginDefinition) {
            logger.warn(
              'Skip connector plugin "%s": export { connectorEntries } is missing',
              moduleName,
            );
            continue;
          }
          registerEntries(pluginDefinition.connectorEntries, moduleName, state);
        } catch (error) {
          logger.warn(
            'Failed to load connector plugin "%s": %s',
            moduleName,
            String(error),
          );
        }
      }
    })();
  }

  await state.pluginsLoadPromise;
};

export const getConnectorCreatorByName = async (
  connectorName: unknown,
  cwd = getTradejsProjectCwd(),
): Promise<ConnectorCreator | undefined> => {
  await ensureConnectorPluginsLoaded(cwd);
  const { state } = getConnectorRegistryState(cwd);
  const raw = String(connectorName ?? '').trim();
  if (!raw) {
    return undefined;
  }

  const direct = state.connectorCreators.get(raw);
  if (direct) {
    return direct;
  }

  const existing = findConnectorNameInsensitive(raw, state.connectorCreators);
  if (!existing) {
    return undefined;
  }

  return state.connectorCreators.get(existing);
};

export const getConnectorNameByProvider = async (
  provider: unknown,
  cwd = getTradejsProjectCwd(),
): Promise<string | undefined> => {
  await ensureConnectorPluginsLoaded(cwd);
  const { state } = getConnectorRegistryState(cwd);
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    return undefined;
  }
  return state.providerToConnectorName.get(normalized);
};

export const getConnectorCreatorByProvider = async (
  provider: unknown,
  cwd = getTradejsProjectCwd(),
): Promise<ConnectorCreator | undefined> => {
  await ensureConnectorPluginsLoaded(cwd);
  const { state } = getConnectorRegistryState(cwd);
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    return undefined;
  }

  const connectorName = state.providerToConnectorName.get(normalized);
  if (!connectorName) {
    return undefined;
  }
  return state.connectorCreators.get(connectorName);
};

export const resolveConnectorName = async (
  providerOrName: unknown,
  cwd = getTradejsProjectCwd(),
): Promise<string | undefined> => {
  await ensureConnectorPluginsLoaded(cwd);
  const { state } = getConnectorRegistryState(cwd);
  const raw = String(providerOrName ?? '').trim();
  if (!raw) {
    return undefined;
  }

  const byProvider = state.providerToConnectorName.get(normalizeProvider(raw));
  if (byProvider) {
    return byProvider;
  }

  return state.connectorCreators.get(raw) && raw
    ? raw
    : findConnectorNameInsensitive(raw, state.connectorCreators) ?? undefined;
};

export const getAvailableConnectorNames = async (
  cwd = getTradejsProjectCwd(),
): Promise<string[]> => {
  await ensureConnectorPluginsLoaded(cwd);
  const { state } = getConnectorRegistryState(cwd);
  return [...state.connectorCreators.keys()].sort((a, b) => a.localeCompare(b));
};

export const getAvailableConnectorProviders = async (
  cwd = getTradejsProjectCwd(),
): Promise<string[]> => {
  await ensureConnectorPluginsLoaded(cwd);
  const { state } = getConnectorRegistryState(cwd);
  return [...state.providerToConnectorName.keys()].sort((a, b) =>
    a.localeCompare(b),
  );
};

export const registerConnectorEntries = (
  entries: readonly ConnectorRegistryEntry[],
  cwd = getTradejsProjectCwd(),
) => {
  const { state } = getConnectorRegistryState(cwd);
  registerEntries(entries, 'runtime', state);
};

export const resetConnectorRegistryCache = (cwd?: string) => {
  const normalizedCwd = String(cwd ?? '').trim();
  if (!normalizedCwd) {
    registryStateByProjectRoot.clear();
    return;
  }

  registryStateByProjectRoot.delete(getTradejsProjectCwd(normalizedCwd));
};

export const DEFAULT_CONNECTOR_NAME = BUILTIN_CONNECTOR_NAMES.ByBit;
