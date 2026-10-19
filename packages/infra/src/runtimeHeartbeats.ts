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
  const previous = await getRuntimeDeploymentHeartbeat(
    userName,
    heartbeat.deploymentId,
  );
  const sameProcess =
    previous?.pid === heartbeat.pid &&
    previous.startedAt === heartbeat.startedAt &&
    previous.deploymentCompositionId === heartbeat.deploymentCompositionId;
  const value: RuntimeDeploymentHeartbeat = {
    ...heartbeat,
    observedAt: Date.now(),
    lastSuccessfulCycleAt:
      heartbeat.cycleStatus === 'completed'
        ? heartbeat.lastCycleAt
        : sameProcess
          ? previous.lastSuccessfulCycleAt
          : undefined,
    lastFailedCycleAt:
      heartbeat.cycleStatus === 'failed'
        ? heartbeat.lastCycleAt
        : sameProcess
          ? previous.lastFailedCycleAt
          : undefined,
  };
  await setData(
    redisKeys.runtimeDeploymentHeartbeat(
      userName,
      normalizeDeploymentId(heartbeat.deploymentId),
    ),
    value,
    { expire: 0 },
  );
  return value;
};
