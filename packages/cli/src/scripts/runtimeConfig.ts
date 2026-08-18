import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getRuntimeDeployment,
  listRuntimeDeployments,
  saveRuntimeDeployment,
} from '@tradejs/infra/runtimeDeployments';
import { getRuntimeStrategyConfig } from '@tradejs/infra/runtimeStrategyConfigs';
import {
  getRuntimeStrategyDraft,
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
  MarketUniverse,
  RuntimeStrategyControlState,
  StrategyConfig,
} from '@tradejs/types';

const argv = process.argv.slice(2);
const action = argv[0] ?? 'inspect';
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
  'configId',
];

const toReleaseConfig = async (
  strategyName: string,
  sourceConfig: StrategyConfig,
) => {
  const defaults = (await getStrategyDefaults(strategyName, projectRoot)) ?? {};
  const config: StrategyConfig = { ...defaults, ...sourceConfig };
  for (const key of OPERATIONAL_CONFIG_KEYS) delete config[key];
  return config;
};

const writeMigrationBackup = async (payload: unknown) => {
  const directory = path.join(projectRoot, 'data', 'runtime-config-backups');
  await mkdir(directory, { recursive: true });
  const backupPath = path.join(
    directory,
    `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(backupPath, `${JSON.stringify(payload, null, 2)}\n`, {
    flag: 'wx',
  });
  return backupPath;
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
  return publishRuntimeStrategyRelease({
    userName,
    strategyName,
    config,
    ...metadata,
    createdBy: `cli:${userName}`,
  });
};

export const buildBootstrapRuntimeDeployment = ({
  deploymentId,
  label,
  connectorName,
  provider,
  accountId,
  strategyName,
  releaseVersion,
  config,
}: {
  deploymentId: string;
  label: string;
  connectorName: string;
  provider: string;
  accountId: string;
  strategyName: string;
  releaseVersion: number;
  config: StrategyConfig;
}): RuntimeDeployment => ({
  id: deploymentId,
  label,
  connectorName,
  provider,
  accountId,
  universe: config.UNIVERSE as MarketUniverse,
  interval: String(config.INTERVAL),
  enabled: true,
  strategies: [
    {
      strategyName,
      releaseVersion,
      controlState: 'entries_paused',
    },
  ],
});

const bootstrap = async () => {
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
  const previewDeployment = buildBootstrapRuntimeDeployment({
    deploymentId,
    label,
    connectorName,
    provider,
    accountId,
    strategyName,
    releaseVersion: 1,
    config: releaseConfig,
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
  const backupPath = await writeMigrationBackup({
    userName,
    capturedAt: Date.now(),
    reason: 'bootstrap',
    sourceConfig,
  });
  const release = await publish({ strategyName, sourceConfig });
  const deployment = await saveRuntimeDeployment(
    userName,
    buildBootstrapRuntimeDeployment({
      deploymentId,
      label,
      connectorName,
      provider,
      accountId,
      strategyName,
      releaseVersion: release.releaseVersion,
      config: release.config,
    }),
  );
  console.log(
    JSON.stringify(
      { bootstrapped: true, backupPath, release, deployment },
      null,
      2,
    ),
  );
};

const migrate = async () => {
  const strategyName = required('strategy');
  const configId = option('config') ?? 'config';
  const deploymentId = required('deployment');
  const [sourceConfig, deployment] = await Promise.all([
    getRuntimeStrategyConfig(userName, strategyName, configId),
    getRuntimeDeployment(userName, deploymentId),
  ]);
  if (!sourceConfig) {
    throw new Error(`Legacy config not found: ${strategyName}:${configId}`);
  }
  if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);
  const reference = deployment.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  if (!reference) {
    throw new Error(`${strategyName} is not bound to ${deploymentId}`);
  }
  const preview = {
    source: { configId, config: sourceConfig },
    releaseConfig: await toReleaseConfig(strategyName, sourceConfig),
    deployment: {
      id: deployment.id,
      accountId: deployment.accountId,
      strategy: {
        strategyName,
        releaseVersion: '<allocated on write>',
        controlState: 'entries_paused',
      },
    },
  };
  if (!hasFlag('write')) {
    console.log(JSON.stringify({ dryRun: true, ...preview }, null, 2));
    return;
  }
  const backupPath = await writeMigrationBackup({
    userName,
    capturedAt: Date.now(),
    deployment,
    legacyConfig: sourceConfig,
  });
  const release = await publish({ strategyName, sourceConfig });
  const updatedDeployment: RuntimeDeployment = {
    ...deployment,
    strategies: deployment.strategies.map((strategy) =>
      strategy.strategyName === strategyName
        ? {
            strategyName,
            releaseVersion: release.releaseVersion,
            controlState: 'entries_paused',
          }
        : strategy,
    ),
  };
  await saveRuntimeDeployment(userName, updatedDeployment);
  console.log(
    JSON.stringify(
      { migrated: true, backupPath, release, deployment: updatedDeployment },
      null,
      2,
    ),
  );
};

const publishDraft = async () => {
  const strategyName = required('strategy');
  const draft = await getRuntimeStrategyDraft(userName, strategyName);
  if (!draft) throw new Error(`Draft not found: ${strategyName}`);
  const release = await publish({ strategyName, sourceConfig: draft.config });
  console.log(JSON.stringify({ release }, null, 2));
};

const updateControlState = async (nextState: RuntimeStrategyControlState) => {
  const strategyName = required('strategy');
  const deploymentId = required('deployment');
  const deployment = await getRuntimeDeployment(userName, deploymentId);
  if (!deployment) throw new Error(`Deployment not found: ${deploymentId}`);
  const reference = deployment.strategies.find(
    (strategy) => strategy.strategyName === strategyName,
  );
  if (!reference?.releaseVersion) {
    throw new Error(`${strategyName} is not a versioned deployment reference`);
  }
  const previousState = reference.controlState ?? 'active';
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
  const backupPath = await writeMigrationBackup({
    userName,
    capturedAt: Date.now(),
    deployment,
    reason: 'rollback',
  });
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
  console.log(JSON.stringify({ backupPath, deployment: updated }, null, 2));
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
        connectorName: deployment.connectorName,
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
  if (action === 'bootstrap') return bootstrap();
  if (action === 'migrate') return migrate();
  if (action === 'publish-draft') return publishDraft();
  if (action === 'verify') return verify();
  if (action === 'pause') return updateControlState('entries_paused');
  if (action === 'resume') return updateControlState('active');
  if (action === 'rollback') return rollback();
  if (action === 'inspect') return inspect();
  throw new Error(
    'Usage: tradejs runtime-config inspect|verify|bootstrap|migrate|publish-draft|pause|resume|rollback',
  );
};

export const main = runtimeConfig;
