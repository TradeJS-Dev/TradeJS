import { randomUUID } from 'node:crypto';
import {
  RUNTIME_DEPLOYMENT_COMPOSITION_EVENT_SCHEMA,
  type RuntimeDeployment,
  type RuntimeDeploymentCompositionEvent,
  type RuntimeDeploymentCompositionEventStrategy,
} from '@tradejs/types';
import { getData, getKeys, redisKeys, setDataStrict } from './redis';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeDeploymentId = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  if (!normalized) throw new Error('Deployment id is required');
  return normalized;
};

export const isRuntimeDeploymentCompositionEvent = (
  value: unknown,
): value is RuntimeDeploymentCompositionEvent => {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          'schema',
          'eventId',
          'deploymentId',
          'deploymentCompositionId',
          'observedAt',
          'strategies',
        ].includes(key),
    ) ||
    value.schema !== RUNTIME_DEPLOYMENT_COMPOSITION_EVENT_SCHEMA ||
    typeof value.eventId !== 'string' ||
    !value.eventId.trim() ||
    typeof value.deploymentId !== 'string' ||
    !value.deploymentId.trim() ||
    typeof value.deploymentCompositionId !== 'string' ||
    !/^dc1:[a-f0-9]{16}$/.test(value.deploymentCompositionId) ||
    typeof value.observedAt !== 'number' ||
    !Number.isFinite(value.observedAt) ||
    value.observedAt < 0 ||
    !Array.isArray(value.strategies)
  ) {
    return false;
  }

  const strategyNames = new Set<string>();
  for (const strategy of value.strategies) {
    if (
      !isRecord(strategy) ||
      Object.keys(strategy).some(
        (key) =>
          ![
            'strategyName',
            'strategyRevision',
            'strategyPackage',
            'strategyPackageVersion',
          ].includes(key),
      ) ||
      typeof strategy.strategyName !== 'string' ||
      !strategy.strategyName.trim() ||
      strategyNames.has(strategy.strategyName) ||
      typeof strategy.strategyRevision !== 'string' ||
      !/^sr1:[a-f0-9]{16}$/.test(strategy.strategyRevision) ||
      (strategy.strategyPackage !== undefined &&
        (typeof strategy.strategyPackage !== 'string' ||
          !strategy.strategyPackage.trim())) ||
      (strategy.strategyPackageVersion !== undefined &&
        (typeof strategy.strategyPackageVersion !== 'string' ||
          !strategy.strategyPackageVersion.trim())) ||
      (strategy.strategyPackage === undefined) !==
        (strategy.strategyPackageVersion === undefined)
    ) {
      return false;
    }
    strategyNames.add(strategy.strategyName);
  }

  return true;
};

export const observeRuntimeDeploymentComposition = async ({
  userName,
  deployment,
  strategies,
  observedAt = Date.now(),
}: {
  userName: string;
  deployment: RuntimeDeployment;
  strategies: Array<Required<RuntimeDeploymentCompositionEventStrategy>>;
  observedAt?: number;
}): Promise<RuntimeDeploymentCompositionEvent | null> => {
  if (!Number.isFinite(observedAt) || observedAt < 0) {
    throw new Error('Invalid deployment composition observation time');
  }
  const deploymentId = normalizeDeploymentId(deployment.id);
  const stateKey = redisKeys.runtimeDeploymentCompositionState(
    userName,
    deploymentId,
  );
  const current = await getData(stateKey, null);
  if (
    isRuntimeDeploymentCompositionEvent(current) &&
    current.deploymentId === deploymentId &&
    current.deploymentCompositionId === deployment.deploymentCompositionId &&
    current.strategies.every(
      (strategy) =>
        strategy.strategyPackage !== undefined &&
        strategy.strategyPackageVersion !== undefined,
    )
  ) {
    return null;
  }

  const event: RuntimeDeploymentCompositionEvent = {
    schema: RUNTIME_DEPLOYMENT_COMPOSITION_EVENT_SCHEMA,
    eventId: `${observedAt}-${randomUUID()}`,
    deploymentId,
    deploymentCompositionId: deployment.deploymentCompositionId,
    observedAt,
    strategies: strategies
      .map(
        ({
          strategyName,
          strategyRevision,
          strategyPackage,
          strategyPackageVersion,
        }) => ({
          strategyName,
          strategyRevision,
          strategyPackage,
          strategyPackageVersion,
        }),
      )
      .sort((left, right) =>
        left.strategyName.localeCompare(right.strategyName),
      ),
  };
  if (!isRuntimeDeploymentCompositionEvent(event)) {
    throw new Error('Invalid runtime deployment composition event');
  }

  await setDataStrict(
    redisKeys.runtimeDeploymentCompositionEvent(
      userName,
      deploymentId,
      event.eventId,
    ),
    event,
    { expire: 0 },
  );
  await setDataStrict(stateKey, event, { expire: 0 });
  return event;
};

export const loadRuntimeDeploymentCompositionEvents = async (
  userName: string,
  deploymentId: string,
): Promise<RuntimeDeploymentCompositionEvent[]> => {
  const normalizedDeploymentId = normalizeDeploymentId(deploymentId);
  const keys = await getKeys(
    redisKeys.runtimeDeploymentCompositionEvents(
      userName,
      normalizedDeploymentId,
    ),
  );
  const values = await Promise.all(keys.map((key) => getData(key, null)));

  return values
    .filter(isRuntimeDeploymentCompositionEvent)
    .filter((event) => event.deploymentId === normalizedDeploymentId)
    .sort(
      (left, right) =>
        left.observedAt - right.observedAt ||
        left.eventId.localeCompare(right.eventId),
    );
};
