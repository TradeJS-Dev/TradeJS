import type {
  RuntimeDeployment,
  RuntimeDeploymentHeartbeat,
} from '@tradejs/types';
import { delKey, getData, getKeys, redisKeys, setData } from './redis';

const normalizeId = (value: string, label: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const isRuntimeDeployment = (value: unknown): value is RuntimeDeployment =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as RuntimeDeployment).id === 'string' &&
      typeof (value as RuntimeDeployment).accountId === 'string',
  );

export const listRuntimeDeployments = async (
  userName: string,
): Promise<RuntimeDeployment[]> => {
  const keys = await getKeys(redisKeys.runtimeDeployments(userName));
  const values = await Promise.all(keys.map((key) => getData(key, null)));
  return values
    .filter(isRuntimeDeployment)
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const getRuntimeDeployment = async (
  userName: string,
  deploymentId: string,
): Promise<RuntimeDeployment | null> => {
  const normalizedId = normalizeId(deploymentId, 'Deployment id');
  const value = await getData(
    redisKeys.runtimeDeployment(userName, normalizedId),
    null,
  );
  return isRuntimeDeployment(value) ? value : null;
};

export const saveRuntimeDeployment = async (
  userName: string,
  deployment: RuntimeDeployment,
): Promise<RuntimeDeployment> => {
  const hasVersionedStrategies = deployment.strategies.some(
    (strategy) => strategy.releaseVersion != null,
  );
  if (
    hasVersionedStrategies &&
    deployment.strategies.some((strategy) => strategy.releaseVersion == null)
  ) {
    throw new Error('A deployment cannot mix legacy configs and releases');
  }
  const strategies: RuntimeDeployment['strategies'] = deployment.strategies.map(
    (strategy) => {
      if (!hasVersionedStrategies) return strategy;
      if (
        !Number.isSafeInteger(strategy.releaseVersion) ||
        !strategy.releaseVersion ||
        (strategy.config && Object.keys(strategy.config).length)
      ) {
        throw new Error(
          `Invalid versioned strategy reference: ${strategy.strategyName}`,
        );
      }
      return {
        strategyName: strategy.strategyName,
        releaseVersion: strategy.releaseVersion,
        controlState:
          strategy.controlState === 'entries_paused'
            ? 'entries_paused'
            : 'active',
      };
    },
  );
  const normalized: RuntimeDeployment = {
    ...deployment,
    id: normalizeId(deployment.id, 'Deployment id'),
    label: deployment.label.trim(),
    provider: deployment.provider.trim().toLowerCase(),
    accountId: normalizeId(deployment.accountId, 'Account id'),
    strategies,
  };
  await setData(
    redisKeys.runtimeDeployment(userName, normalized.id),
    normalized,
    { expire: 0 },
  );
  return normalized;
};

export const deleteRuntimeDeployment = async (
  userName: string,
  deploymentId: string,
) => {
  const normalizedId = normalizeId(deploymentId, 'Deployment id');
  await Promise.all([
    delKey(redisKeys.runtimeDeployment(userName, normalizedId)),
    delKey(redisKeys.runtimeDeploymentHeartbeat(userName, normalizedId)),
  ]);
};

export const getRuntimeDeploymentHeartbeat = async (
  userName: string,
  deploymentId: string,
): Promise<RuntimeDeploymentHeartbeat | null> => {
  const value = await getData(
    redisKeys.runtimeDeploymentHeartbeat(
      userName,
      normalizeId(deploymentId, 'Deployment id'),
    ),
    null,
  );
  return value && typeof value === 'object'
    ? (value as RuntimeDeploymentHeartbeat)
    : null;
};

export const saveRuntimeDeploymentHeartbeat = async (
  userName: string,
  heartbeat: RuntimeDeploymentHeartbeat,
) => {
  await setData(
    redisKeys.runtimeDeploymentHeartbeat(
      userName,
      normalizeId(heartbeat.deploymentId, 'Deployment id'),
    ),
    heartbeat,
    { expire: 0 },
  );
  return heartbeat;
};
