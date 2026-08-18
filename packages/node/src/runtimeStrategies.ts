import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getRuntimeStrategyRelease } from '@tradejs/infra/runtimeStrategyReleases';
import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import type {
  Interval,
  MarketUniverse,
  RuntimeDeployment,
  RuntimeStrategyControlState,
  RuntimeStrategyRelease,
  StrategyConfig,
  StrategyCreator,
} from '@tradejs/types';
import {
  getStrategyCreator,
  getStrategyPluginSource,
} from './strategy/manifests';

export interface ResolvedRuntimeStrategy {
  strategyName: string;
  releaseVersion: number;
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
  if (release.strategyPackageVersion !== installedStrategyVersion) {
    throw new Error(
      `${release.strategyName} v${release.releaseVersion} requires ${release.strategyPackage}@${release.strategyPackageVersion}, image has ${installedStrategyVersion}`,
    );
  }
  const installedRuntimeVersion = await resolveInstalledPackageVersion(
    projectRoot,
    '@tradejs/node',
    packageManifest,
  );
  if (release.runtimePackageVersion !== installedRuntimeVersion) {
    throw new Error(
      `${release.strategyName} v${release.releaseVersion} requires @tradejs/node@${release.runtimePackageVersion}, image has ${installedRuntimeVersion}`,
    );
  }
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
  return account?.id ?? deployment.accountId;
};

const loadVersionedRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
}: {
  userName: string;
  projectRoot: string;
  deployment: RuntimeDeployment;
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
      if (
        Object.keys(reference).some(
          (key) =>
            !['strategyName', 'releaseVersion', 'controlState'].includes(key),
        )
      ) {
        throw new Error(`Deployment ${deployment.id} has invalid fields`);
      }
      if (!reference.controlState) {
        throw new Error(
          `Deployment ${deployment.id} strategy ${reference.strategyName} has no controlState`,
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
        universe,
      });
      return {
        strategyName: reference.strategyName,
        releaseVersion: release.releaseVersion,
        controlState: reference.controlState,
        interval,
        universe,
        accountId,
        strategyPackage: release.strategyPackage,
        strategyPackageVersion: release.strategyPackageVersion,
        runtimePackageVersion: release.runtimePackageVersion,
        strategyCreator,
        sourceStrategyConfig: release.config,
        strategyConfig: release.config,
      } satisfies ResolvedRuntimeStrategy;
    }),
  );
};

export const loadResolvedRuntimeStrategies = async ({
  userName,
  projectRoot,
  deployment,
  universe,
  accountId,
  interval,
}: {
  userName: string;
  projectRoot: string;
  deployment?: RuntimeDeployment | null;
  universe?: MarketUniverse;
  accountId?: string;
  interval?: Interval;
}): Promise<ResolvedRuntimeStrategy[]> => {
  if (!deployment) throw new Error('Runtime deployment is required');
  const strategies = await loadVersionedRuntimeStrategies({
    userName,
    projectRoot,
    deployment,
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
