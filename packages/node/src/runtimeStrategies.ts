import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { getRuntimeStrategyRelease } from '@tradejs/infra/runtimeStrategyReleases';
import { loadRuntimeStrategyConfigs } from '@tradejs/infra/runtimeStrategyConfigs';
import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import type {
  Interval,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeStrategyControlState,
  RuntimeStrategyRelease,
  StrategyConfig,
  StrategyCreator,
  StrategyResults,
} from '@tradejs/types';
import {
  getStrategyCreator,
  getStrategyPluginSource,
} from './strategy/manifests';

export interface ResolvedRuntimeStrategy {
  strategyName: string;
  /** Legacy-only Redis config identity. */
  configId?: string;
  releaseVersion?: number;
  controlState: RuntimeStrategyControlState;
  interval: Interval;
  universe: MarketUniverse;
  accountId?: string;
  strategyPackage?: string | null;
  strategyPackageVersion?: string | null;
  runtimePackageVersion?: string | null;
  strategyCreator: StrategyCreator;
  sourceStrategyConfig: StrategyConfig;
  strategyConfig: StrategyConfig;
  strategyResults: StrategyResults;
}

type RuntimePackageManifest = {
  packages?: Record<string, string>;
};

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
      // A local source checkout does not have to carry a generated image manifest.
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

const validateReleaseRuntimeCompatibility = async ({
  release,
  projectRoot,
  packageManifest,
}: {
  release: RuntimeStrategyRelease;
  projectRoot: string;
  packageManifest: RuntimePackageManifest;
}) => {
  const installedStrategyVersion = await resolveInstalledPackageVersion(
    projectRoot,
    release.strategyPackage,
    packageManifest,
  );
  if (
    release.strategyPackageVersion &&
    installedStrategyVersion &&
    release.strategyPackageVersion !== installedStrategyVersion
  ) {
    throw new Error(
      `${release.strategyName} v${release.releaseVersion} requires ${release.strategyPackage}@${release.strategyPackageVersion}, image has ${installedStrategyVersion}`,
    );
  }
  const installedRuntimeVersion = packageManifest.packages?.['@tradejs/node'];
  if (
    release.runtimePackageVersion &&
    installedRuntimeVersion &&
    release.runtimePackageVersion !== installedRuntimeVersion
  ) {
    throw new Error(
      `${release.strategyName} v${release.releaseVersion} requires @tradejs/node@${release.runtimePackageVersion}, image has ${installedRuntimeVersion}`,
    );
  }
};

const resolveAccountId = async ({
  userName,
  deployment,
  connectorName,
  universe,
  legacyAccountId,
}: {
  userName: string;
  deployment?: RuntimeDeployment | null;
  connectorName: string;
  universe: MarketUniverse;
  legacyAccountId?: string;
}) => {
  const requestedAccountId = deployment?.accountId ?? legacyAccountId;
  const account = await resolveTradingAccount({
    userName,
    accountId: requestedAccountId,
    provider: deployment?.provider ?? connectorName,
    universe,
  });
  return account?.id ?? requestedAccountId;
};

const loadVersionedRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
  connectorName,
}: {
  userName: string;
  projectRoot: string;
  deployment: RuntimeDeployment;
  connectorName: string;
}): Promise<ResolvedRuntimeStrategy[]> => {
  const packageManifest = await readPackageManifest(projectRoot);
  return Promise.all(
    deployment.strategies.map(async (reference) => {
      if (
        !Number.isSafeInteger(reference.releaseVersion) ||
        !reference.releaseVersion
      ) {
        throw new Error(
          `Deployment ${deployment.id} strategy ${reference.strategyName} has no releaseVersion`,
        );
      }
      if (reference.config && Object.keys(reference.config).length) {
        throw new Error(
          `Deployment ${deployment.id} must not embed config for ${reference.strategyName}`,
        );
      }
      const release = await getRuntimeStrategyRelease(
        userName,
        reference.strategyName,
        reference.releaseVersion,
      );
      if (!release) {
        throw new Error(
          `Runtime release not found: ${reference.strategyName} v${reference.releaseVersion}`,
        );
      }
      await validateReleaseRuntimeCompatibility({
        release,
        projectRoot,
        packageManifest,
      });
      const strategyCreator = await getStrategyCreator(
        reference.strategyName,
        projectRoot,
      );
      if (!strategyCreator) {
        throw new Error(`Unknown strategy: ${reference.strategyName}`);
      }
      const interval = String(release.config.INTERVAL) as Interval;
      const universe = release.config.UNIVERSE as MarketUniverse;
      const accountId = await resolveAccountId({
        userName,
        deployment,
        connectorName,
        universe,
      });
      return {
        strategyName: reference.strategyName,
        releaseVersion: release.releaseVersion,
        controlState: reference.controlState ?? 'active',
        interval,
        universe,
        accountId,
        strategyPackage: release.strategyPackage,
        strategyPackageVersion: release.strategyPackageVersion,
        runtimePackageVersion: release.runtimePackageVersion,
        strategyCreator,
        sourceStrategyConfig: release.config,
        strategyConfig: release.config,
        // Symbol result configs are mutable legacy overlays and are not read by v2.
        strategyResults: {},
      } satisfies ResolvedRuntimeStrategy;
    }),
  );
};

const loadLegacyRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
  connectorName,
}: {
  userName: string;
  projectRoot: string;
  deployment?: RuntimeDeployment | null;
  connectorName: string;
}): Promise<ResolvedRuntimeStrategy[]> => {
  const deploymentStrategies = new Map(
    (deployment?.strategies ?? []).map((strategy) => [
      strategy.strategyName,
      strategy,
    ]),
  );
  const candidates = await Promise.all(
    (await loadRuntimeStrategyConfigs(userName)).map(async (record) => {
      const binding = deploymentStrategies.get(record.strategyName);
      if (
        binding?.enabled === false ||
        record.strategyConfig.ENABLE === false
      ) {
        return null;
      }
      const universe = (
        record.strategyConfig.UNIVERSE === 'tradfi' ? 'tradfi' : 'crypto'
      ) as MarketUniverse;
      const interval = String(
        record.strategyConfig.INTERVAL ?? '15',
      ) as Interval;
      const accountId = await resolveAccountId({
        userName,
        deployment,
        connectorName,
        universe,
        legacyAccountId:
          typeof record.strategyConfig.ACCOUNT_ID === 'string'
            ? record.strategyConfig.ACCOUNT_ID
            : undefined,
      });
      const [strategyCreator, strategyResults] = await Promise.all([
        getStrategyCreator(record.strategyName, projectRoot),
        getData(redisKeys.strategyResults(userName, record.strategyName), {}),
      ]);
      if (!strategyCreator) return null;
      return {
        strategyName: record.strategyName,
        configId: record.configId,
        controlState: 'active',
        interval,
        universe,
        accountId,
        strategyCreator,
        sourceStrategyConfig: record.strategyConfig,
        strategyConfig: record.strategyConfig,
        strategyResults: (strategyResults ?? {}) as StrategyResults,
      } satisfies ResolvedRuntimeStrategy;
    }),
  );
  return candidates.filter(Boolean) as ResolvedRuntimeStrategy[];
};

export const loadResolvedRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
  connectorName = 'bybit',
  universe,
  accountId,
  interval,
}: {
  userName: string;
  projectRoot: string;
  deployment?: RuntimeDeployment | null;
  connectorName?: string;
  universe?: MarketUniverse;
  accountId?: string;
  interval?: Interval;
}): Promise<ResolvedRuntimeStrategy[]> => {
  const hasVersionedReferences = Boolean(
    deployment?.strategies.some((strategy) => strategy.releaseVersion != null),
  );
  if (
    hasVersionedReferences &&
    deployment?.strategies.some((strategy) => strategy.releaseVersion == null)
  ) {
    throw new Error(
      `Deployment ${deployment.id} mixes legacy configs and versioned releases`,
    );
  }
  const strategies = hasVersionedReferences
    ? await loadVersionedRuntimeStrategies({
        userName,
        projectRoot,
        deployment: deployment!,
        connectorName,
      })
    : await loadLegacyRuntimeStrategies({
        userName,
        projectRoot,
        deployment,
        connectorName,
      });
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
  const strategyPackage =
    (await getStrategyPluginSource(strategyName, projectRoot)) ?? null;
  return {
    strategyPackage,
    strategyPackageVersion: await resolveInstalledPackageVersion(
      projectRoot,
      strategyPackage,
      packageManifest,
    ),
    runtimePackageVersion: packageManifest.packages?.['@tradejs/node'] ?? null,
  };
};
