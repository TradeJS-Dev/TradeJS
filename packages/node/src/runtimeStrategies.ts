import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRuntimeControls } from '@tradejs/infra/runtimeControls';
import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import type {
  Interval,
  MarketUniverse,
  RuntimeControls,
  RuntimeDeployment,
  RuntimeDeploymentDeclaration,
  RuntimeStrategySelection,
  RuntimeStrategyControlState,
  StrategyConfig,
  StrategyCreator,
  TradejsRuntimeDeclaration,
} from '@tradejs/types';
import { getStrategyCreator, getStrategyPluginSource } from './strategy';
import { loadTradejsConfig } from './tradejsConfig';

export interface ResolvedRuntimeStrategy {
  strategyName: string;
  version: number;
  enabled: boolean;
  controlState: RuntimeStrategyControlState;
  interval: Interval;
  universe: MarketUniverse;
  accountId?: string;
  strategyPackage: string;
  strategyPackageVersion: string;
  runtimePackageVersion: string;
  strategyCreator: StrategyCreator;
  sourceStrategyConfig: StrategyConfig;
  strategyConfig: StrategyConfig;
  selection?: RuntimeStrategySelection;
}

type RuntimePackageManifest = {
  packages?: Record<string, string>;
};

const INTERVALS = new Set([
  '1',
  '3',
  '5',
  '15',
  '30',
  '60',
  '120',
  '240',
  '360',
  '720',
  'D',
  'W',
  'M',
]);
const RUNTIME_KEYS = new Set(['deployments']);
const DEPLOYMENT_KEYS = new Set([
  'label',
  'connectorName',
  'provider',
  'accountId',
  'enabled',
  'strategies',
  'assetClasses',
  'tickers',
]);
const STRATEGY_KEYS = new Set(['version', 'enabled', 'selection', 'config']);
const SELECTION_KEYS = new Set(['tickers']);
const FORBIDDEN_CONFIG_KEYS = new Set([
  'ACCOUNT_ID',
  'DEPLOYMENT_ID',
  'CONNECTOR_NAME',
  'ENABLE',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readPackageManifest = async (
  projectRoot: string,
): Promise<RuntimePackageManifest> => {
  const candidates = [
    process.env.TRADEJS_RUNTIME_PACKAGE_MANIFEST,
    path.join(projectRoot, 'runtime-package-manifest.json'),
    '/app/runtime-package-manifest.json',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      return JSON.parse(
        await readFile(candidate, 'utf8'),
      ) as RuntimePackageManifest;
    } catch {
      // Source checkouts resolve versions from installed package manifests.
    }
  }
  return { packages: {} };
};

const resolveInstalledPackageVersion = async (
  projectRoot: string,
  packageName: string | null | undefined,
  manifest: RuntimePackageManifest,
) => {
  if (!packageName || packageName === 'runtime') return null;
  const manifestVersion = manifest.packages?.[packageName];
  if (manifestVersion) return manifestVersion;
  try {
    const packageJsonPath = path.join(
      projectRoot,
      'node_modules',
      ...packageName.split('/'),
      'package.json',
    );
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      version?: string;
    };
    return packageJson.version ?? null;
  } catch {
    return null;
  }
};

const resolveStrategyPackageName = async ({
  pluginSource,
  projectRoot,
}: {
  pluginSource: string | null;
  projectRoot: string;
}) => {
  if (!pluginSource) return null;
  if (!pluginSource.startsWith('.') && !path.isAbsolute(pluginSource)) {
    return pluginSource;
  }
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { name?: unknown };
    return typeof packageJson.name === 'string' && packageJson.name.trim()
      ? packageJson.name
      : null;
  } catch {
    return null;
  }
};

const verifyStringArray = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string'));

const verifyStrategySelection = (value: unknown) =>
  value === undefined ||
  (isRecord(value) &&
    Object.keys(value).length === 1 &&
    Object.keys(value).every((key) => SELECTION_KEYS.has(key)) &&
    Array.isArray(value.tickers) &&
    value.tickers.length > 0 &&
    value.tickers.every(
      (ticker) => typeof ticker === 'string' && ticker.trim().length > 0,
    ));

const cloneSelection = (
  selection: RuntimeStrategySelection | undefined,
): RuntimeStrategySelection | undefined =>
  selection ? { tickers: [...selection.tickers] } : undefined;

const resolveStrategySelection = ({
  deployment,
  strategy,
}: {
  deployment: RuntimeDeploymentDeclaration;
  strategy: RuntimeDeploymentDeclaration['strategies'][string];
}): RuntimeStrategySelection | undefined =>
  cloneSelection(
    strategy.selection ??
      (deployment.tickers ? { tickers: deployment.tickers } : undefined),
  );

const verifyDeploymentDeclaration = (
  deploymentId: string,
  value: unknown,
): RuntimeDeploymentDeclaration => {
  if (
    !deploymentId.trim() ||
    !isRecord(value) ||
    Object.keys(value).some((key) => !DEPLOYMENT_KEYS.has(key)) ||
    typeof value.connectorName !== 'string' ||
    !value.connectorName.trim() ||
    typeof value.accountId !== 'string' ||
    !value.accountId.trim() ||
    (value.label !== undefined && typeof value.label !== 'string') ||
    (value.provider !== undefined && typeof value.provider !== 'string') ||
    (value.enabled !== undefined && typeof value.enabled !== 'boolean') ||
    !verifyStringArray(value.assetClasses) ||
    !verifyStringArray(value.tickers) ||
    !isRecord(value.strategies) ||
    !Object.keys(value.strategies).length
  ) {
    throw new Error(`Invalid runtime deployment declaration: ${deploymentId}`);
  }

  for (const [strategyName, strategyValue] of Object.entries(
    value.strategies,
  )) {
    if (
      !strategyName.trim() ||
      !isRecord(strategyValue) ||
      Object.keys(strategyValue).some((key) => !STRATEGY_KEYS.has(key)) ||
      !Number.isSafeInteger(strategyValue.version) ||
      Number(strategyValue.version) <= 0 ||
      typeof strategyValue.enabled !== 'boolean' ||
      !verifyStrategySelection(strategyValue.selection) ||
      !isRecord(strategyValue.config) ||
      Object.keys(strategyValue.config).some((key) =>
        FORBIDDEN_CONFIG_KEYS.has(key),
      ) ||
      !INTERVALS.has(String(strategyValue.config.INTERVAL)) ||
      !['crypto', 'tradfi'].includes(String(strategyValue.config.UNIVERSE))
    ) {
      throw new Error(
        `Invalid runtime strategy declaration: ${deploymentId}/${strategyName}`,
      );
    }
  }

  return value as unknown as RuntimeDeploymentDeclaration;
};

export const verifyRuntimeDeclaration = (
  value: unknown,
): TradejsRuntimeDeclaration => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !RUNTIME_KEYS.has(key)) ||
    !isRecord(value.deployments) ||
    !Object.keys(value.deployments).length
  ) {
    throw new Error('Invalid runtime declaration');
  }
  for (const [deploymentId, deployment] of Object.entries(value.deployments)) {
    verifyDeploymentDeclaration(deploymentId, deployment);
  }
  return value as unknown as TradejsRuntimeDeclaration;
};

const toRuntimeDeployment = ({
  id,
  declaration,
  controls,
}: {
  id: string;
  declaration: RuntimeDeploymentDeclaration;
  controls: RuntimeControls;
}): RuntimeDeployment => {
  const deploymentEnabled = declaration.enabled ?? true;
  return {
    id,
    label: declaration.label?.trim() || id,
    connectorName: declaration.connectorName.trim(),
    provider: (declaration.provider || declaration.connectorName)
      .trim()
      .toLowerCase(),
    accountId: declaration.accountId.trim(),
    enabled: deploymentEnabled,
    strategies: Object.entries(declaration.strategies).map(
      ([strategyName, strategy]) => {
        const selection = resolveStrategySelection({
          deployment: declaration,
          strategy,
        });
        return {
          strategyName,
          version: strategy.version,
          enabled: strategy.enabled,
          controlState:
            deploymentEnabled &&
            strategy.enabled &&
            !controls.deployments[id]?.[strategyName]?.entriesPaused
              ? 'active'
              : 'entries_paused',
          ...(selection ? { selection } : {}),
        };
      },
    ),
    ...(declaration.assetClasses
      ? { assetClasses: declaration.assetClasses }
      : {}),
    ...(declaration.tickers ? { tickers: declaration.tickers } : {}),
  };
};

const loadRuntimeDeclaration = async (projectRoot: string) => {
  const projectConfig = await loadTradejsConfig(projectRoot);
  if (!projectConfig.runtime) {
    throw new Error('Runtime declaration is required in tradejs.config.ts');
  }
  return verifyRuntimeDeclaration(projectConfig.runtime);
};

export const listRuntimeDeployments = async ({
  userName,
  projectRoot,
}: {
  userName: string;
  projectRoot: string;
}): Promise<RuntimeDeployment[]> => {
  const [runtime, controls] = await Promise.all([
    loadRuntimeDeclaration(projectRoot),
    getRuntimeControls(userName),
  ]);
  return Object.entries(runtime.deployments)
    .map(([id, declaration]) =>
      toRuntimeDeployment({ id, declaration, controls }),
    )
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const getRuntimeDeployment = async ({
  userName,
  projectRoot,
  deploymentId,
}: {
  userName: string;
  projectRoot: string;
  deploymentId: string;
}): Promise<RuntimeDeployment | null> => {
  const deployments = await listRuntimeDeployments({ userName, projectRoot });
  return (
    deployments.find((deployment) => deployment.id === deploymentId) ?? null
  );
};

const resolveAccountId = async ({
  userName,
  deployment,
  universe,
}: {
  userName: string;
  deployment: RuntimeDeployment;
  universe: MarketUniverse;
}) => {
  const account = await resolveTradingAccount({
    userName,
    accountId: deployment.accountId,
    provider: deployment.provider,
    universe,
  });
  if (!account) {
    throw new Error(`Trading account not found: ${deployment.accountId}`);
  }
  return account.id;
};

export const loadResolvedRuntimeStrategies = async ({
  userName,
  projectRoot,
  deploymentId,
  universe,
  accountId,
  interval,
}: {
  userName: string;
  projectRoot: string;
  deploymentId: string;
  universe?: MarketUniverse;
  accountId?: string;
  interval?: Interval;
}): Promise<ResolvedRuntimeStrategy[]> => {
  const [runtime, controls, packageManifest] = await Promise.all([
    loadRuntimeDeclaration(projectRoot),
    getRuntimeControls(userName),
    readPackageManifest(projectRoot),
  ]);
  const declaration = runtime.deployments[deploymentId];
  if (!declaration) {
    throw new Error(`Runtime deployment not found: ${deploymentId}`);
  }
  const deployment = toRuntimeDeployment({
    id: deploymentId,
    declaration,
    controls,
  });
  const strategies = await Promise.all(
    Object.entries(declaration.strategies).map(
      async ([strategyName, strategyDeclaration]) => {
        const strategyCreator = await getStrategyCreator(
          strategyName,
          projectRoot,
        );
        if (!strategyCreator) {
          throw new Error(`Unknown strategy: ${strategyName}`);
        }
        const pluginSource =
          (await getStrategyPluginSource(strategyName, projectRoot)) ?? null;
        const strategyPackage = await resolveStrategyPackageName({
          pluginSource,
          projectRoot,
        });
        const [strategyPackageVersion, runtimePackageVersion] =
          await Promise.all([
            resolveInstalledPackageVersion(
              projectRoot,
              strategyPackage,
              packageManifest,
            ),
            resolveInstalledPackageVersion(
              projectRoot,
              '@tradejs/node',
              packageManifest,
            ),
          ]);
        if (!strategyPackage || !strategyPackageVersion) {
          throw new Error(
            `Installed strategy package not found: ${strategyName}`,
          );
        }
        if (!runtimePackageVersion) {
          throw new Error('Installed @tradejs/node package version not found');
        }
        const strategyView = deployment.strategies.find(
          (candidate) => candidate.strategyName === strategyName,
        );
        const selection = resolveStrategySelection({
          deployment: declaration,
          strategy: strategyDeclaration,
        });
        const strategyConfig = strategyDeclaration.config;
        const strategyUniverse = strategyConfig.UNIVERSE as MarketUniverse;
        const resolvedAccountId = await resolveAccountId({
          userName,
          deployment,
          universe: strategyUniverse,
        });
        return {
          strategyName,
          version: strategyDeclaration.version,
          enabled: strategyDeclaration.enabled,
          controlState: strategyView?.controlState ?? 'entries_paused',
          interval: String(strategyConfig.INTERVAL) as Interval,
          universe: strategyUniverse,
          accountId: resolvedAccountId,
          strategyPackage,
          strategyPackageVersion,
          runtimePackageVersion,
          strategyCreator,
          sourceStrategyConfig: strategyConfig,
          strategyConfig,
          ...(selection ? { selection } : {}),
        } satisfies ResolvedRuntimeStrategy;
      },
    ),
  );

  const filtered = strategies.filter(
    (candidate) =>
      (!universe || candidate.universe === universe) &&
      (!interval || String(candidate.interval) === String(interval)) &&
      (!accountId || candidate.accountId === accountId),
  );
  const identities = new Set<string>();
  for (const candidate of filtered) {
    const identity = `${candidate.strategyName}:${candidate.accountId ?? 'default'}`;
    if (identities.has(identity)) {
      throw new Error(`Runtime strategy conflict: ${identity}`);
    }
    identities.add(identity);
  }
  return filtered;
};

export const getRuntimeStrategyPackageMetadata = async ({
  strategyName,
  projectRoot,
}: {
  strategyName: string;
  projectRoot: string;
}) => {
  const packageManifest = await readPackageManifest(projectRoot);
  const pluginSource =
    (await getStrategyPluginSource(strategyName, projectRoot)) ?? null;
  const strategyPackage = await resolveStrategyPackageName({
    pluginSource,
    projectRoot,
  });
  return {
    strategyPackage,
    strategyPackageVersion: await resolveInstalledPackageVersion(
      projectRoot,
      strategyPackage,
      packageManifest,
    ),
    runtimePackageVersion: await resolveInstalledPackageVersion(
      projectRoot,
      '@tradejs/node',
      packageManifest,
    ),
  };
};
