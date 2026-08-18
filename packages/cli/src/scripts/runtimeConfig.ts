import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  getRuntimeDeployment,
  listRuntimeDeployments,
  saveRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import {
  getRuntimeStrategyRelease,
  listRuntimeStrategyReleases,
  publishRuntimeStrategyRelease,
  recordRuntimeStrategyControlEvent,
} from '@tradejs/infra/runtimeStrategyReleases';
import {
  getRuntimeStrategyPackageMetadata,
  loadResolvedRuntimeStrategies,
} from '@tradejs/node/runtimeStrategies';
import { getStrategyDefaults } from '@tradejs/node/strategies';
import type {
  RuntimeDeployment,
  RuntimeStrategyControlState,
  StrategyConfig,
} from '@tradejs/types';

const argv = process.argv.slice(2);
export const RUNTIME_CONFIG_ACTIONS = [
  'inspect',
  'verify',
  'provision',
  'rollout',
  'pause',
  'resume',
  'rollback',
] as const;
type RuntimeConfigAction = (typeof RUNTIME_CONFIG_ACTIONS)[number];
const action = (argv[0] ?? 'inspect') as RuntimeConfigAction;
const option = (name: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};
const hasFlag = (name: string) => argv.includes(`--${name}`);
const required = (name: string) => {
  const value = String(option(name) ?? '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
};

const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
const userName = String(option('user') ?? process.env.USER_NAME ?? 'root');
const OPERATIONAL_CONFIG_KEYS = [
  'ACCOUNT_ID',
  'AI_REPLAY_ANALYSES',
  'DEPLOYMENT_ID',
  'ENABLE',
  'ENV',
  'MAKE_ORDERS',
  'RECORD_RUNTIME_TRADES',
];

const requireRuntimePackageIdentity = (
  strategyName: string,
  metadata: Awaited<ReturnType<typeof getRuntimeStrategyPackageMetadata>>,
) => {
  if (
    !metadata.strategyPackage ||
    !metadata.strategyPackageVersion ||
    !metadata.runtimePackageVersion
  ) {
    throw new Error(
      `Runtime package manifest is incomplete for ${strategyName}`,
    );
  }
  return {
    strategyPackage: metadata.strategyPackage,
    strategyPackageVersion: metadata.strategyPackageVersion,
    runtimePackageVersion: metadata.runtimePackageVersion,
  };
};

const toReleaseConfig = async (
  strategyName: string,
  sourceConfig: StrategyConfig,
) => {
  const defaults = (await getStrategyDefaults(strategyName, projectRoot)) ?? {};
  const config: StrategyConfig = { ...defaults, ...sourceConfig };
  for (const key of OPERATIONAL_CONFIG_KEYS) delete config[key];
  return config;
};

const publish = async ({
  strategyName,
  sourceConfig,
}: {
  strategyName: string;
  sourceConfig: StrategyConfig;
}) => {
  const config = await toReleaseConfig(strategyName, sourceConfig);
  const metadata = await getRuntimeStrategyPackageMetadata({
    strategyName,
    projectRoot,
  });
  const packageIdentity = requireRuntimePackageIdentity(strategyName, metadata);
  return publishRuntimeStrategyRelease({
    userName,
    strategyName,
    config,
    ...packageIdentity,
    createdBy: `cli:${userName}`,
  });
};

export const buildProvisionedRuntimeDeployment = ({
  deploymentId,
  label,
  connectorName,
  provider,
  accountId,
  strategyName,
  releaseVersion,
}: {
  deploymentId: string;
  label: string;
  connectorName: string;
  provider: string;
  accountId: string;
  strategyName: string;
  releaseVersion: number;
}): RuntimeDeployment => ({
  id: deploymentId,
  label,
  connectorName,
  provider,
  accountId,
  enabled: true,
  strategies: [
    {
      strategyName,
      releaseVersion,
      controlState: 'entries_paused',
    },
  ],
});

export const isEquivalentRuntimeStrategyRelease = ({
  release,
  config,
  strategyPackage,
  strategyPackageVersion,
  runtimePackageVersion,
}: {
  release: {
    config: StrategyConfig;
    strategyPackage: string;
    strategyPackageVersion: string;
    runtimePackageVersion: string;
  } | null;
  config: StrategyConfig;
  strategyPackage: string;
  strategyPackageVersion: string;
  runtimePackageVersion: string;
}) =>
  Boolean(
    release &&
      isDeepStrictEqual(release.config, config) &&
      release.strategyPackage === strategyPackage &&
      release.strategyPackageVersion === strategyPackageVersion &&
      release.runtimePackageVersion === runtimePackageVersion,
  );

export const pointRuntimeDeploymentAtRelease = ({
  deployment,
  strategyName,
  releaseVersion,
}: {
  deployment: RuntimeDeployment;
  strategyName: string;
  releaseVersion: number;
}): RuntimeDeployment => ({
  ...deployment,
  strategies: deployment.strategies.map((strategy) =>
    strategy.strategyName === strategyName
      ? {
          strategyName,
          releaseVersion,
          controlState: 'entries_paused',
        }
      : strategy,
  ),
});

const provision = async () => {
  const strategyName = required('strategy');
  const deploymentId = required('deployment');
  const accountId = required('account');
  const connectorName = option('connector') ?? 'bybit';
  const provider = option('provider') ?? connectorName;
  const label = option('label') ?? deploymentId;
  const configFile = path.resolve(projectRoot, required('file'));
  const sourceConfig = JSON.parse(
    await readFile(configFile, 'utf8'),
  ) as StrategyConfig;
  const existingDeployment = await getRuntimeDeployment(userName, deploymentId);
  if (existingDeployment) {
    throw new Error(
      `Deployment already exists: ${deploymentId}; publish a release and switch its pointer instead`,
    );
  }
  const releaseConfig = await toReleaseConfig(strategyName, sourceConfig);
  const previewDeployment = buildProvisionedRuntimeDeployment({
    deploymentId,
    label,
    connectorName,
    provider,
    accountId,
    strategyName,
    releaseVersion: 1,
  });
  if (!hasFlag('write')) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          releaseConfig,
          deployment: {
            ...previewDeployment,
            strategies: previewDeployment.strategies.map((strategy) => ({
              ...strategy,
              releaseVersion: '<allocated on write>',
            })),
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  const release = await publish({ strategyName, sourceConfig });
  const deployment = await saveRuntimeDeployment(
    userName,
    buildProvisionedRuntimeDeployment({
      deploymentId,
      label,
      connectorName,
      provider,
      accountId,
      strategyName,
      releaseVersion: release.releaseVersion,
    }),
  );
  console.log(
    JSON.stringify({ provisioned: true, release, deployment }, null, 2),
  );
};

const rollout = async () => {
  const strategyName = required('strategy');
  const deploymentId = required('deployment');
  const configFile = path.resolve(projectRoot, required('file'));
  const [deployment, sourceConfig] = await Promise.all([
    getRuntimeDeployment(userName, deploymentId),
    readFile(configFile, 'utf8').then(
      (value) => JSON.parse(value) as StrategyConfig,
    ),
  ]);
  if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);
  const reference = deployment.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  if (!reference)
    throw new Error(`${strategyName} is not bound to ${deploymentId}`);
  const [config, metadata, currentRelease] = await Promise.all([
    toReleaseConfig(strategyName, sourceConfig),
    getRuntimeStrategyPackageMetadata({ strategyName, projectRoot }),
    getRuntimeStrategyRelease(userName, strategyName, reference.releaseVersion),
  ]);
  const packageIdentity = requireRuntimePackageIdentity(strategyName, metadata);
  const unchanged = isEquivalentRuntimeStrategyRelease({
    release: currentRelease,
    config,
    ...packageIdentity,
  });
  const preview = {
    deploymentId,
    strategyName,
    currentReleaseVersion: reference.releaseVersion,
    nextControlState: 'entries_paused' as const,
    unchanged,
    config,
    ...packageIdentity,
  };
  if (!hasFlag('write')) {
    console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2));
    return;
  }
  if (unchanged) {
    console.log(
      JSON.stringify(
        {
          rolledOut: false,
          reason: 'release_config_and_packages_unchanged',
          release: currentRelease,
          deployment,
        },
        null,
        2,
      ),
    );
    return;
  }
  const release = await publishRuntimeStrategyRelease({
    userName,
    strategyName,
    config,
    ...packageIdentity,
    createdBy: `cli:${userName}`,
  });
  const updatedDeployment = pointRuntimeDeploymentAtRelease({
    deployment,
    strategyName,
    releaseVersion: release.releaseVersion,
  });
  await saveRuntimeDeployment(userName, updatedDeployment);
  console.log(
    JSON.stringify(
      {
        rolledOut: true,
        release,
        deployment: updatedDeployment,
      },
      null,
      2,
    ),
  );
};

const updateControlState = async (nextState: RuntimeStrategyControlState) => {
  const strategyName = required('strategy');
  const deploymentId = required('deployment');
  const deployment = await getRuntimeDeployment(userName, deploymentId);
  if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);
  const reference = deployment.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  if (!reference)
    throw new Error(`${strategyName} is not bound to ${deploymentId}`);
  const previousState = reference.controlState;
  const updated = await saveRuntimeDeployment(userName, {
    ...deployment,
    strategies: deployment.strategies.map((strategy) =>
      strategy.strategyName === strategyName
        ? { ...strategy, controlState: nextState }
        : strategy,
    ),
  });
  const event =
    previousState === nextState
      ? null
      : await recordRuntimeStrategyControlEvent({
          userName,
          deploymentId,
          strategyName,
          releaseVersion: reference.releaseVersion,
          previousState,
          nextState,
          createdBy: `cli:${userName}`,
        });
  console.log(JSON.stringify({ deployment: updated, event }, null, 2));
};

const rollback = async () => {
  const strategyName = required('strategy');
  const deploymentId = required('deployment');
  const releaseVersion = Number(required('release'));
  if (!Number.isSafeInteger(releaseVersion) || releaseVersion <= 0) {
    throw new Error('--release must be a positive integer');
  }
  const deployment = await getRuntimeDeployment(userName, deploymentId);
  if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);
  const release = (
    await listRuntimeStrategyReleases(userName, strategyName)
  ).find((candidate) => candidate.releaseVersion === releaseVersion);
  if (!release)
    throw new Error(`Release not found: ${strategyName} v${releaseVersion}`);
  const updated = await saveRuntimeDeployment(userName, {
    ...deployment,
    strategies: deployment.strategies.map((strategy) =>
      strategy.strategyName === strategyName
        ? {
            strategyName,
            releaseVersion,
            controlState: 'entries_paused',
          }
        : strategy,
    ),
  });
  console.log(JSON.stringify({ deployment: updated }, null, 2));
};

const verify = async () => {
  const deployments = await listRuntimeDeployments(userName);
  const selected = option('deployment')
    ? deployments.filter((deployment) => deployment.id === option('deployment'))
    : deployments;
  const results = [];
  for (const deployment of selected) {
    try {
      const strategies = await loadResolvedRuntimeStrategies({
        userName,
        projectRoot,
        deployment,
      });
      results.push({
        deploymentId: deployment.id,
        ok: true,
        strategies: strategies.map((strategy) => ({
          strategyName: strategy.strategyName,
          releaseVersion: strategy.releaseVersion,
          controlState: strategy.controlState,
          interval: strategy.interval,
          universe: strategy.universe,
          accountId: strategy.accountId,
        })),
      });
    } catch (error) {
      results.push({
        deploymentId: deployment.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log(JSON.stringify({ userName, results }, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 1;
};

const inspect = async () => {
  const strategyName = option('strategy');
  const deployments = await listRuntimeDeployments(userName);
  const releases = strategyName
    ? await listRuntimeStrategyReleases(userName, strategyName)
    : undefined;
  console.log(JSON.stringify({ userName, deployments, releases }, null, 2));
};

export const runtimeConfig = async () => {
  if (action === 'provision') return provision();
  if (action === 'rollout') return rollout();
  if (action === 'verify') return verify();
  if (action === 'pause') return updateControlState('entries_paused');
  if (action === 'resume') return updateControlState('active');
  if (action === 'rollback') return rollback();
  if (action === 'inspect') return inspect();
  throw new Error(
    `Usage: tradejs runtime-config ${RUNTIME_CONFIG_ACTIONS.join('|')}`,
  );
};

export const main = runtimeConfig;
