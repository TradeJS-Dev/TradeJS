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

const DEPLOYMENT_KEYS = new Set([
  'id',
  'label',
  'connectorName',
  'provider',
  'accountId',
  'enabled',
  'strategies',
  'assetClasses',
  'tickers',
]);
const REFERENCE_KEYS = new Set([
  'strategyName',
  'releaseVersion',
  'controlState',
]);

export const verifyRuntimeDeployment = (value: unknown): RuntimeDeployment => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid runtime deployment');
  }
  const deployment = value as Record<string, unknown>;
  const strategies = deployment.strategies;
  if (
    Object.keys(deployment).some((key) => !DEPLOYMENT_KEYS.has(key)) ||
    typeof deployment.id !== 'string' ||
    typeof deployment.label !== 'string' ||
    typeof deployment.connectorName !== 'string' ||
    typeof deployment.provider !== 'string' ||
    typeof deployment.accountId !== 'string' ||
    typeof deployment.enabled !== 'boolean' ||
    !Array.isArray(strategies) ||
    !strategies.length ||
    strategies.some((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return true;
      }
      const reference = value as Record<string, unknown>;
      return (
        Object.keys(reference).some((key) => !REFERENCE_KEYS.has(key)) ||
        typeof reference.strategyName !== 'string' ||
        !reference.strategyName.trim() ||
        !Number.isSafeInteger(reference.releaseVersion) ||
        Number(reference.releaseVersion) <= 0 ||
        (reference.controlState !== 'active' &&
          reference.controlState !== 'entries_paused')
      );
    })
  ) {
    throw new Error('Invalid runtime deployment');
  }
  return value as RuntimeDeployment;
};

export const listRuntimeDeployments = async (
  userName: string,
): Promise<RuntimeDeployment[]> => {
  const keys = await getKeys(redisKeys.runtimeDeployments(userName));
  const deploymentKeys = keys.filter((key) => !key.endsWith(':heartbeat'));
  const values = await Promise.all(
    deploymentKeys.map((key) => getData(key, null)),
  );
  return values
    .filter((value) => value != null)
    .map(verifyRuntimeDeployment)
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
  return value == null ? null : verifyRuntimeDeployment(value);
};

export const saveRuntimeDeployment = async (
  userName: string,
  deployment: RuntimeDeployment,
): Promise<RuntimeDeployment> => {
  const strategies: RuntimeDeployment['strategies'] = deployment.strategies.map(
    (strategy) => {
      if (
        !Number.isSafeInteger(strategy.releaseVersion) ||
        !strategy.releaseVersion ||
        (strategy.controlState !== 'active' &&
          strategy.controlState !== 'entries_paused')
      ) {
        throw new Error(
          `Invalid runtime strategy reference: ${strategy.strategyName}`,
        );
      }
      return {
        strategyName: strategy.strategyName,
        releaseVersion: strategy.releaseVersion,
        controlState: strategy.controlState,
      };
    },
  );
  const normalized: RuntimeDeployment = {
    id: normalizeId(deployment.id, 'Deployment id'),
    label: deployment.label.trim(),
    connectorName: deployment.connectorName.trim(),
    provider: deployment.provider.trim().toLowerCase(),
    accountId: normalizeId(deployment.accountId, 'Account id'),
    enabled: deployment.enabled,
    strategies,
    assetClasses: deployment.assetClasses,
    tickers: deployment.tickers,
  };
  verifyRuntimeDeployment(normalized);
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
