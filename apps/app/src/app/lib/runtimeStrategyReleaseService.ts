import {
  getRuntimeStrategyDraft,
  listRuntimeStrategyReleases,
  publishRuntimeStrategyRelease,
  saveRuntimeStrategyDraft,
} from '@tradejs/infra/runtimeStrategyReleases';
import { getRuntimeStrategyPackageMetadata } from '@tradejs/node/runtimeStrategies';
import {
  getAvailableStrategyNames,
  getStrategyDefaults,
} from '@tradejs/node/strategies';
import type { StrategyConfig } from '@tradejs/types';

const OPERATIONAL_KEYS = [
  'ACCOUNT_ID',
  'AI_REPLAY_ANALYSES',
  'DEPLOYMENT_ID',
  'ENABLE',
  'ENV',
  'MAKE_ORDERS',
  'RECORD_RUNTIME_TRADES',
  'configId',
];

const assertConfig = (value: unknown): StrategyConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Strategy config must be a JSON object');
  }
  const config = value as StrategyConfig;
  const invalidKey = OPERATIONAL_KEYS.find((key) => config[key] !== undefined);
  if (invalidKey) {
    throw new Error(
      `${invalidKey} is controlled by the deployment, not config`,
    );
  }
  return config;
};

const assertKnownStrategy = async (
  strategyName: string,
  projectRoot: string,
) => {
  if (!(await getAvailableStrategyNames(projectRoot)).includes(strategyName)) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }
};

export const getRuntimeStrategyReleaseOptions = async ({
  userName,
  projectRoot,
}: {
  userName: string;
  projectRoot: string;
}) => {
  const strategyNames = await getAvailableStrategyNames(projectRoot);
  const strategies = await Promise.all(
    strategyNames.map(async (strategyName) => ({
      strategyName,
      draft: await getRuntimeStrategyDraft(userName, strategyName),
      releases: await listRuntimeStrategyReleases(userName, strategyName),
    })),
  );
  return { strategyNames, strategies };
};

export const saveRuntimeStrategyReleaseDraftForUser = async ({
  userName,
  projectRoot,
  input,
}: {
  userName: string;
  projectRoot: string;
  input: Record<string, unknown>;
}) => {
  const strategyName = String(input.strategyName ?? '').trim();
  await assertKnownStrategy(strategyName, projectRoot);
  return saveRuntimeStrategyDraft({
    userName,
    strategyName,
    config: assertConfig(input.config),
    baseReleaseVersion:
      typeof input.baseReleaseVersion === 'number'
        ? input.baseReleaseVersion
        : null,
    updatedBy: userName,
  });
};

export const publishRuntimeStrategyReleaseForUser = async ({
  userName,
  projectRoot,
  strategyName,
}: {
  userName: string;
  projectRoot: string;
  strategyName: string;
}) => {
  await assertKnownStrategy(strategyName, projectRoot);
  const draft = await getRuntimeStrategyDraft(userName, strategyName);
  if (!draft) throw new Error(`Draft not found: ${strategyName}`);
  const defaults = (await getStrategyDefaults(strategyName, projectRoot)) ?? {};
  const config: StrategyConfig = { ...defaults, ...draft.config };
  for (const key of OPERATIONAL_KEYS) delete config[key];
  const metadata = await getRuntimeStrategyPackageMetadata({
    strategyName,
    projectRoot,
  });
  const release = await publishRuntimeStrategyRelease({
    userName,
    strategyName,
    config,
    ...metadata,
    createdBy: userName,
  });
  await saveRuntimeStrategyDraft({
    userName,
    strategyName,
    config: release.config,
    baseReleaseVersion: release.releaseVersion,
    updatedBy: userName,
  });
  return release;
};
