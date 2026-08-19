import type { RuntimeDeploymentHeartbeat } from '@tradejs/types';
import { getData, redisKeys, setData } from './redis';

const normalizeDeploymentId = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  if (!normalized) throw new Error('Deployment id is required');
  return normalized;
};

export const getRuntimeDeploymentHeartbeat = async (
  userName: string,
  deploymentId: string,
): Promise<RuntimeDeploymentHeartbeat | null> => {
  const value = await getData(
    redisKeys.runtimeDeploymentHeartbeat(
      userName,
      normalizeDeploymentId(deploymentId),
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
      normalizeDeploymentId(heartbeat.deploymentId),
    ),
    heartbeat,
    { expire: 0 },
  );
  return heartbeat;
};
