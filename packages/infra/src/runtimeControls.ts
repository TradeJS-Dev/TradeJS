import { randomUUID } from 'node:crypto';
import {
  RUNTIME_CONTROLS_SCHEMA,
  type RuntimeControls,
  type RuntimeStrategyControlEvent,
  type RuntimeStrategyControlState,
  type RuntimeStrategyPauseOverride,
} from '@tradejs/types';
import { delKeyStrict, getDataStrict, redisKeys, setDataStrict } from './redis';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const verifyPauseOverride = (
  value: unknown,
): value is RuntimeStrategyPauseOverride =>
  isRecord(value) &&
  Object.keys(value).every((key) =>
    ['entriesPaused', 'updatedAt', 'updatedBy'].includes(key),
  ) &&
  value.entriesPaused === true &&
  typeof value.updatedAt === 'string' &&
  Number.isFinite(Date.parse(value.updatedAt)) &&
  typeof value.updatedBy === 'string' &&
  Boolean(value.updatedBy.trim());

export const emptyRuntimeControls = (): RuntimeControls => ({
  schema: RUNTIME_CONTROLS_SCHEMA,
  deployments: {},
});

export const verifyRuntimeControls = (value: unknown): RuntimeControls => {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['schema', 'deployments'].includes(key),
    ) ||
    value.schema !== RUNTIME_CONTROLS_SCHEMA ||
    !isRecord(value.deployments)
  ) {
    throw new Error('Invalid runtime controls');
  }

  for (const [deploymentId, strategyOverrides] of Object.entries(
    value.deployments,
  )) {
    if (!deploymentId.trim() || !isRecord(strategyOverrides)) {
      throw new Error('Invalid runtime controls');
    }
    for (const [strategyName, override] of Object.entries(strategyOverrides)) {
      if (!strategyName.trim() || !verifyPauseOverride(override)) {
        throw new Error('Invalid runtime controls');
      }
    }
  }

  return value as unknown as RuntimeControls;
};

export const getRuntimeControls = async (
  userName: string,
): Promise<RuntimeControls> => {
  const value = await getDataStrict(redisKeys.runtimeControls(userName));
  return value == null ? emptyRuntimeControls() : verifyRuntimeControls(value);
};

export const pauseRuntimeStrategy = async ({
  userName,
  deploymentId,
  strategyName,
  updatedBy,
  updatedAt = new Date().toISOString(),
}: {
  userName: string;
  deploymentId: string;
  strategyName: string;
  updatedBy: string;
  updatedAt?: string;
}): Promise<RuntimeControls> => {
  const controls = await getRuntimeControls(userName);
  const next: RuntimeControls = {
    ...controls,
    deployments: {
      ...controls.deployments,
      [deploymentId]: {
        ...controls.deployments[deploymentId],
        [strategyName]: {
          entriesPaused: true,
          updatedAt,
          updatedBy: updatedBy.trim(),
        },
      },
    },
  };
  const verified = verifyRuntimeControls(next);
  await setDataStrict(redisKeys.runtimeControls(userName), verified, {
    expire: 0,
  });
  return verified;
};

export const resumeRuntimeStrategy = async ({
  userName,
  deploymentId,
  strategyName,
}: {
  userName: string;
  deploymentId: string;
  strategyName: string;
}): Promise<RuntimeControls> => {
  const controls = await getRuntimeControls(userName);
  const deployment = { ...controls.deployments[deploymentId] };
  delete deployment[strategyName];
  const deployments = { ...controls.deployments };
  if (Object.keys(deployment).length) {
    deployments[deploymentId] = deployment;
  } else {
    delete deployments[deploymentId];
  }
  const next = verifyRuntimeControls({ ...controls, deployments });
  if (Object.keys(deployments).length) {
    await setDataStrict(redisKeys.runtimeControls(userName), next, {
      expire: 0,
    });
  } else {
    await delKeyStrict(redisKeys.runtimeControls(userName));
  }
  return next;
};

export const recordRuntimeStrategyControlEvent = async ({
  userName,
  deploymentId,
  strategyName,
  strategyRevision,
  previousState,
  nextState,
  createdBy,
}: {
  userName: string;
  deploymentId: string;
  strategyName: string;
  strategyRevision: string;
  previousState: RuntimeStrategyControlState;
  nextState: RuntimeStrategyControlState;
  createdBy: string;
}): Promise<RuntimeStrategyControlEvent> => {
  const action = nextState === 'entries_paused' ? 'pause_entries' : 'resume';
  const createdAt = Date.now();
  const event: RuntimeStrategyControlEvent = {
    eventId: `${createdAt}-${randomUUID()}`,
    deploymentId,
    strategyName,
    strategyRevision,
    action,
    previousState,
    nextState,
    createdAt,
    createdBy,
  };
  await setDataStrict(
    redisKeys.runtimeStrategyControlEvent(userName, event.eventId),
    event,
    { expire: 0 },
  );
  return event;
};
