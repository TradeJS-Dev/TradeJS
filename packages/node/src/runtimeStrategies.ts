import { createHash } from 'node:crypto';
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
import {
  getStrategyCreator,
  getStrategyEntry,
  getStrategyPluginSource,
} from './strategy';
import { loadTradejsConfig } from './tradejsConfig';

export const RUNTIME_PACKAGE_MANIFEST_SCHEMA =
  'tradejs-runtime-package-manifest/v1' as const;

export interface RuntimePackageManifest {
  schema: typeof RUNTIME_PACKAGE_MANIFEST_SCHEMA;
  projectSha: string;
  packages: Record<string, string>;
}

export interface ResolvedRuntimeStrategy {
  strategyName: string;
  strategyRevision: string;
  deploymentCompositionId: string;
  generation?: string;
  enabled: boolean;
  controlState: RuntimeStrategyControlState;
  interval: Interval;
  universe: MarketUniverse;
  accountId?: string;
  strategyPackage: string;
  strategyPackageVersion: string;
  strategyDependencyVersions: Record<string, string>;
  runtimePackageVersion: string;
  strategyCreator: StrategyCreator;
  sourceStrategyConfig: StrategyConfig;
  strategyConfig: StrategyConfig;
  selection?: RuntimeStrategySelection;
}

interface ResolvedStrategyComposition {
  strategyName: string;
  strategyRevision: string;
  generation?: string;
  enabled: boolean;
  interval: Interval;
  universe: MarketUniverse;
  strategyPackage: string;
  strategyPackageVersion: string;
  strategyDependencyVersions: Record<string, string>;
  runtimePackageVersion: string;
  strategyCreator: StrategyCreator;
  sourceStrategyConfig: StrategyConfig;
  strategyConfig: StrategyConfig;
  selection?: RuntimeStrategySelection;
}

export interface ResolvedRuntimeDeploymentComposition {
  deploymentId: string;
  deploymentCompositionId: string;
  declaration: RuntimeDeploymentDeclaration;
  strategies: ResolvedStrategyComposition[];
}

export interface ResolvedRuntimeComposition {
  deployments: ResolvedRuntimeDeploymentComposition[];
}

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
const STRATEGY_KEYS = new Set(['generation', 'enabled', 'selection', 'config']);
const SELECTION_KEYS = new Set(['tickers']);
const FORBIDDEN_CONFIG_KEYS = new Set([
  'ACCOUNT_ID',
  'DEPLOYMENT_ID',
  'CONNECTOR_NAME',
  'ENABLE',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeForCanonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForCanonicalJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [
          key,
          normalizeForCanonicalJson(nestedValue),
        ]),
    );
  }
  return value;
};

const revision = (prefix: 'dc1' | 'sr1', value: unknown) =>
  `${prefix}:${createHash('sha256')
    .update(JSON.stringify(normalizeForCanonicalJson(value)))
    .digest('hex')
    .slice(0, 16)}`;

export const computeStrategyRevision = ({
  strategyName,
  strategyPackage,
  strategyPackageVersion,
  strategyDependencyVersions,
  runtimePackageVersion,
  strategyConfig,
}: {
  strategyName: string;
  strategyPackage: string;
  strategyPackageVersion: string;
  strategyDependencyVersions: Record<string, string>;
  runtimePackageVersion: string;
  strategyConfig: StrategyConfig;
}) =>
  revision('sr1', {
    schema: 'tradejs-strategy-revision/v1',
    strategyName,
    strategyPackage,
    strategyPackageVersion,
    strategyDependencyVersions,
    runtimePackageVersion,
    strategyConfig,
  });

export const computeDeploymentCompositionId = (value: {
  deploymentId: string;
  connectorName: string;
  provider: string;
  accountId: string;
  enabled: boolean;
  assetClasses?: readonly string[];
  strategies: readonly {
    strategyName: string;
    strategyRevision: string;
    enabled: boolean;
    selection?: RuntimeStrategySelection;
  }[];
}) =>
  revision('dc1', {
    schema: 'tradejs-deployment-composition/v1',
    ...value,
    assetClasses: value.assetClasses
      ? [...value.assetClasses].sort((left, right) => left.localeCompare(right))
      : undefined,
    strategies: [...value.strategies]
      .sort((left, right) =>
        left.strategyName.localeCompare(right.strategyName),
      )
      .map((strategy) => ({
        ...strategy,
        selection: strategy.selection
          ? {
              tickers: [...strategy.selection.tickers].sort((left, right) =>
                left.localeCompare(right),
              ),
            }
          : undefined,
      })),
  });

const readRuntimePackageManifest = async (
  projectRoot: string,
): Promise<RuntimePackageManifest> => {
  const manifestPath =
    process.env.TRADEJS_RUNTIME_PACKAGE_MANIFEST?.trim() ||
    path.join(projectRoot, 'runtime-package-manifest.json');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read runtime package manifest ${manifestPath}: ${String(error)}`,
    );
  }
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['schema', 'projectSha', 'packages'].includes(key),
    ) ||
    value.schema !== RUNTIME_PACKAGE_MANIFEST_SCHEMA ||
    typeof value.projectSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(value.projectSha) ||
    !isRecord(value.packages) ||
    Object.keys(value.packages).length === 0 ||
    Object.entries(value.packages).some(
      ([packageName, version]) =>
        !packageName.trim() || typeof version !== 'string' || !version.trim(),
    )
  ) {
    throw new Error(`Invalid runtime package manifest: ${manifestPath}`);
  }
  return value as unknown as RuntimePackageManifest;
};

interface InstalledPackageMetadata {
  version: string;
  runtimeDependencies: string[];
}

const readInstalledPackageMetadata = async ({
  projectRoot,
  packageName,
  projectPackage,
}: {
  projectRoot: string;
  packageName: string;
  projectPackage: boolean;
}) => {
  const packageJsonPath = projectPackage
    ? path.join(projectRoot, 'package.json')
    : path.join(
        projectRoot,
        'node_modules',
        ...packageName.split('/'),
        'package.json',
      );
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      name?: unknown;
      version?: unknown;
      dependencies?: unknown;
      peerDependencies?: unknown;
    };
    if (
      (packageJson.name !== undefined && packageJson.name !== packageName) ||
      typeof packageJson.version !== 'string' ||
      !packageJson.version.trim()
    ) {
      throw new Error('name or version is invalid');
    }
    const dependencyNames = [
      ...(isRecord(packageJson.dependencies)
        ? Object.keys(packageJson.dependencies)
        : []),
      ...(isRecord(packageJson.peerDependencies)
        ? Object.keys(packageJson.peerDependencies)
        : []),
    ];
    return {
      version: packageJson.version,
      runtimeDependencies: [...new Set(dependencyNames)]
        .filter((name) => name.startsWith('@tradejs/'))
        .sort((left, right) => left.localeCompare(right)),
    } satisfies InstalledPackageMetadata;
  } catch (error) {
    throw new Error(
      `Installed package manifest not found for ${packageName}: ${String(error)}`,
    );
  }
};

const resolveVerifiedPackageVersion = async ({
  projectRoot,
  packageName,
  manifest,
  projectPackage = false,
}: {
  projectRoot: string;
  packageName: string;
  manifest: RuntimePackageManifest;
  projectPackage?: boolean;
}) => {
  const declaredVersion = manifest.packages[packageName];
  if (!declaredVersion) {
    throw new Error(`Runtime package manifest is missing ${packageName}`);
  }
  const installed = await readInstalledPackageMetadata({
    projectRoot,
    packageName,
    projectPackage,
  });
  if (declaredVersion !== installed.version) {
    throw new Error(
      `Runtime package manifest mismatch for ${packageName}: declared=${declaredVersion} installed=${installed.version}`,
    );
  }
  return installed.version;
};

const resolveVerifiedStrategyDependencyVersions = async ({
  projectRoot,
  strategyPackage,
  manifest,
}: {
  projectRoot: string;
  strategyPackage: { name: string; projectPackage: boolean };
  manifest: RuntimePackageManifest;
}) => {
  const metadata = await readInstalledPackageMetadata({
    projectRoot,
    packageName: strategyPackage.name,
    projectPackage: strategyPackage.projectPackage,
  });
  return Object.fromEntries(
    await Promise.all(
      metadata.runtimeDependencies.map(async (packageName) => [
        packageName,
        await resolveVerifiedPackageVersion({
          projectRoot,
          packageName,
          manifest,
        }),
      ]),
    ),
  );
};

const resolveStrategyPackage = async ({
  pluginSource,
  projectRoot,
}: {
  pluginSource: string | null;
  projectRoot: string;
}): Promise<{ name: string; projectPackage: boolean } | null> => {
  if (!pluginSource) return null;
  if (!pluginSource.startsWith('.') && !path.isAbsolute(pluginSource)) {
    return { name: pluginSource, projectPackage: false };
  }
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
    ) as { name?: unknown };
    return typeof packageJson.name === 'string' && packageJson.name.trim()
      ? { name: packageJson.name, projectPackage: true }
      : null;
  } catch {
    return null;
  }
};

const verifyStringSet = (value: unknown) =>
  value === undefined ||
  (Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'string' && item.length > 0 && item === item.trim(),
    ) &&
    new Set(value).size === value.length);

const verifyStrategySelection = (value: unknown) =>
  value === undefined ||
  (isRecord(value) &&
    Object.keys(value).length === 1 &&
    Object.keys(value).every((key) => SELECTION_KEYS.has(key)) &&
    value.tickers !== undefined &&
    verifyStringSet(value.tickers));

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
    !verifyStringSet(value.assetClasses) ||
    !verifyStringSet(value.tickers) ||
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
      (strategyValue.generation !== undefined &&
        (typeof strategyValue.generation !== 'string' ||
          !strategyValue.generation.trim())) ||
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

const loadRuntimeDeclaration = async (projectRoot: string) => {
  const projectConfig = await loadTradejsConfig(projectRoot);
  if (!projectConfig.runtime) {
    throw new Error('Runtime declaration is required in tradejs.config.ts');
  }
  return verifyRuntimeDeclaration(projectConfig.runtime);
};

const resolveStrategyComposition = async ({
  strategyName,
  declaration,
  deployment,
  projectRoot,
  packageManifest,
}: {
  strategyName: string;
  declaration: RuntimeDeploymentDeclaration['strategies'][string];
  deployment: RuntimeDeploymentDeclaration;
  projectRoot: string;
  packageManifest: RuntimePackageManifest;
}): Promise<ResolvedStrategyComposition> => {
  const [strategyEntry, strategyCreator, pluginSource] = await Promise.all([
    getStrategyEntry(strategyName, projectRoot),
    getStrategyCreator(strategyName, projectRoot),
    getStrategyPluginSource(strategyName, projectRoot),
  ]);
  if (!strategyEntry || !strategyCreator) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
  if (typeof strategyEntry.parseConfig !== 'function') {
    throw new Error(`Strategy config parser is missing: ${strategyName}`);
  }
  const strategyPackage = await resolveStrategyPackage({
    pluginSource: pluginSource ?? null,
    projectRoot,
  });
  if (!strategyPackage) {
    throw new Error(`Installed strategy package not found: ${strategyName}`);
  }
  const [
    strategyPackageVersion,
    strategyDependencyVersions,
    runtimePackageVersion,
  ] = await Promise.all([
    resolveVerifiedPackageVersion({
      projectRoot,
      packageName: strategyPackage.name,
      projectPackage: strategyPackage.projectPackage,
      manifest: packageManifest,
    }),
    resolveVerifiedStrategyDependencyVersions({
      projectRoot,
      strategyPackage,
      manifest: packageManifest,
    }),
    resolveVerifiedPackageVersion({
      projectRoot,
      packageName: '@tradejs/node',
      manifest: packageManifest,
    }),
  ]);
  const parsedConfig = strategyEntry.parseConfig(declaration.config);
  if (!isRecord(parsedConfig)) {
    throw new Error(
      `Strategy config parser returned a non-object: ${strategyName}`,
    );
  }
  const strategyConfig = parsedConfig as StrategyConfig;
  const selection = resolveStrategySelection({
    deployment,
    strategy: declaration,
  });
  return {
    strategyName,
    strategyRevision: computeStrategyRevision({
      strategyName,
      strategyPackage: strategyPackage.name,
      strategyPackageVersion,
      strategyDependencyVersions,
      runtimePackageVersion,
      strategyConfig,
    }),
    ...(declaration.generation ? { generation: declaration.generation } : {}),
    enabled: declaration.enabled,
    interval: String(strategyConfig.INTERVAL) as Interval,
    universe: strategyConfig.UNIVERSE as MarketUniverse,
    strategyPackage: strategyPackage.name,
    strategyPackageVersion,
    strategyDependencyVersions,
    runtimePackageVersion,
    strategyCreator,
    sourceStrategyConfig: declaration.config,
    strategyConfig,
    ...(selection ? { selection } : {}),
  };
};

export const resolveRuntimeComposition = async ({
  projectRoot,
}: {
  projectRoot: string;
}): Promise<ResolvedRuntimeComposition> => {
  const [runtime, packageManifest] = await Promise.all([
    loadRuntimeDeclaration(projectRoot),
    readRuntimePackageManifest(projectRoot),
  ]);
  const deployments = await Promise.all(
    Object.entries(runtime.deployments).map(
      async ([deploymentId, declaration]) => {
        const strategies = await Promise.all(
          Object.entries(declaration.strategies).map(
            ([strategyName, strategyDeclaration]) =>
              resolveStrategyComposition({
                strategyName,
                declaration: strategyDeclaration,
                deployment: declaration,
                projectRoot,
                packageManifest,
              }),
          ),
        );
        const provider = (declaration.provider || declaration.connectorName)
          .trim()
          .toLowerCase();
        return {
          deploymentId,
          deploymentCompositionId: computeDeploymentCompositionId({
            deploymentId,
            connectorName: declaration.connectorName.trim(),
            provider,
            accountId: declaration.accountId.trim(),
            enabled: declaration.enabled ?? true,
            ...(declaration.assetClasses
              ? { assetClasses: declaration.assetClasses }
              : {}),
            strategies: strategies.map((strategy) => ({
              strategyName: strategy.strategyName,
              strategyRevision: strategy.strategyRevision,
              enabled: strategy.enabled,
              ...(strategy.selection ? { selection: strategy.selection } : {}),
            })),
          }),
          declaration,
          strategies,
        } satisfies ResolvedRuntimeDeploymentComposition;
      },
    ),
  );
  return {
    deployments: deployments.sort((left, right) =>
      left.deploymentId.localeCompare(right.deploymentId),
    ),
  };
};

const toRuntimeDeployment = ({
  composition,
  controls,
}: {
  composition: ResolvedRuntimeDeploymentComposition;
  controls: RuntimeControls;
}): RuntimeDeployment => {
  const { declaration, deploymentId } = composition;
  const deploymentEnabled = declaration.enabled ?? true;
  return {
    id: deploymentId,
    deploymentCompositionId: composition.deploymentCompositionId,
    label: declaration.label?.trim() || deploymentId,
    connectorName: declaration.connectorName.trim(),
    provider: (declaration.provider || declaration.connectorName)
      .trim()
      .toLowerCase(),
    accountId: declaration.accountId.trim(),
    enabled: deploymentEnabled,
    strategies: composition.strategies.map((strategy) => ({
      strategyName: strategy.strategyName,
      strategyRevision: strategy.strategyRevision,
      enabled: strategy.enabled,
      controlState:
        deploymentEnabled &&
        strategy.enabled &&
        !controls.deployments[deploymentId]?.[strategy.strategyName]
          ?.entriesPaused
          ? 'active'
          : 'entries_paused',
      ...(strategy.selection ? { selection: strategy.selection } : {}),
    })),
    ...(declaration.assetClasses
      ? { assetClasses: declaration.assetClasses }
      : {}),
    ...(declaration.tickers ? { tickers: declaration.tickers } : {}),
  };
};

export const listRuntimeDeployments = async ({
  userName,
  projectRoot,
}: {
  userName: string;
  projectRoot: string;
}): Promise<RuntimeDeployment[]> => {
  const [composition, controls] = await Promise.all([
    resolveRuntimeComposition({ projectRoot }),
    getRuntimeControls(userName),
  ]);
  return composition.deployments
    .map((deploymentComposition) =>
      toRuntimeDeployment({ composition: deploymentComposition, controls }),
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
  const [composition, controls] = await Promise.all([
    resolveRuntimeComposition({ projectRoot }),
    getRuntimeControls(userName),
  ]);
  const deploymentComposition = composition.deployments.find(
    (candidate) => candidate.deploymentId === deploymentId,
  );
  if (!deploymentComposition) {
    throw new Error(`Runtime deployment not found: ${deploymentId}`);
  }
  const deployment = toRuntimeDeployment({
    composition: deploymentComposition,
    controls,
  });
  const strategies = await Promise.all(
    deploymentComposition.strategies.map(async (strategy) => {
      const strategyView = deployment.strategies.find(
        (candidate) => candidate.strategyName === strategy.strategyName,
      );
      const resolvedAccountId = await resolveAccountId({
        userName,
        deployment,
        universe: strategy.universe,
      });
      return {
        ...strategy,
        deploymentCompositionId: deploymentComposition.deploymentCompositionId,
        accountId: resolvedAccountId,
        controlState: strategyView?.controlState ?? 'entries_paused',
      } satisfies ResolvedRuntimeStrategy;
    }),
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
  const [packageManifest, pluginSource] = await Promise.all([
    readRuntimePackageManifest(projectRoot),
    getStrategyPluginSource(strategyName, projectRoot),
  ]);
  const strategyPackage = await resolveStrategyPackage({
    pluginSource: pluginSource ?? null,
    projectRoot,
  });
  if (!strategyPackage) {
    throw new Error(`Installed strategy package not found: ${strategyName}`);
  }
  const [
    strategyPackageVersion,
    strategyDependencyVersions,
    runtimePackageVersion,
  ] = await Promise.all([
    resolveVerifiedPackageVersion({
      projectRoot,
      packageName: strategyPackage.name,
      projectPackage: strategyPackage.projectPackage,
      manifest: packageManifest,
    }),
    resolveVerifiedStrategyDependencyVersions({
      projectRoot,
      strategyPackage,
      manifest: packageManifest,
    }),
    resolveVerifiedPackageVersion({
      projectRoot,
      packageName: '@tradejs/node',
      manifest: packageManifest,
    }),
  ]);
  return {
    strategyPackage: strategyPackage.name,
    strategyPackageVersion,
    strategyDependencyVersions,
    runtimePackageVersion,
  };
};
