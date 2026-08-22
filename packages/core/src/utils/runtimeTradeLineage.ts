import type { MarketUniverse, RuntimeLineage } from '@tradejs/types';

export interface RuntimeStrategyLineageScope {
  strategy: string;
  symbol: string;
  runtimeConfigId?: string;
  lineage: RuntimeLineage & { maxLossValue?: number | null };
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface RuntimeStrategyMaxLossValueChange {
  timestamp: number;
  previousValue: number;
  value: number;
}

export interface RuntimeStrategyMaxLossValueTimeline {
  observedFrom: number | null;
  initialValue: number | null;
  changes: RuntimeStrategyMaxLossValueChange[];
}

export const buildRuntimeStrategyIdentityKey = ({
  strategyName,
  configId,
  universe,
  accountId,
  deploymentId,
  policyProfileId,
}: {
  strategyName: string;
  configId?: string;
  universe?: MarketUniverse;
  accountId?: string;
  deploymentId?: string;
  policyProfileId?: string;
}) =>
  [
    strategyName,
    configId ?? 'config',
    universe ?? 'crypto',
    accountId ?? 'default',
    deploymentId ?? 'default',
    policyProfileId ?? 'default',
  ].join(':');

export const getRuntimeStrategyAiGateObservedFrom = ({
  scopes,
  strategyName,
  configId,
  endTime,
}: {
  scopes: RuntimeStrategyLineageScope[];
  strategyName: string;
  configId?: string;
  endTime: number;
}) => {
  const normalizedConfigId = configId ?? 'config';
  let observedFrom: number | null = null;
  for (const scope of scopes) {
    if (
      scope.strategy !== strategyName ||
      (scope.runtimeConfigId ?? 'config') !== normalizedConfigId ||
      scope.firstTimestamp > endTime
    ) {
      continue;
    }
    observedFrom =
      observedFrom == null
        ? scope.firstTimestamp
        : Math.min(observedFrom, scope.firstTimestamp);
  }
  return observedFrom;
};

export const buildRuntimeStrategyMaxLossValueTimeline = ({
  scopes,
  strategyName,
  configId,
  startTime,
  endTime,
}: {
  scopes: RuntimeStrategyLineageScope[];
  strategyName: string;
  configId?: string;
  startTime: number;
  endTime: number;
}): RuntimeStrategyMaxLossValueTimeline => {
  const normalizedConfigId = configId ?? 'config';
  const observationsByTimestamp = new Map<
    number,
    { value: number; lastTimestamp: number }
  >();
  for (const scope of scopes) {
    const value = scope.lineage.maxLossValue;
    if (
      scope.strategy !== strategyName ||
      (scope.runtimeConfigId ?? 'config') !== normalizedConfigId ||
      scope.firstTimestamp > endTime ||
      typeof value !== 'number' ||
      !Number.isFinite(value)
    ) {
      continue;
    }
    const existing = observationsByTimestamp.get(scope.firstTimestamp);
    if (
      !existing ||
      scope.lastTimestamp > existing.lastTimestamp ||
      (scope.lastTimestamp === existing.lastTimestamp && value > existing.value)
    ) {
      observationsByTimestamp.set(scope.firstTimestamp, {
        value,
        lastTimestamp: scope.lastTimestamp,
      });
    }
  }

  const changes: RuntimeStrategyMaxLossValueChange[] = [];
  let observedFrom: number | null = null;
  let initialValue: number | null = null;
  let currentValue: number | null = null;
  for (const [timestamp, observation] of [
    ...observationsByTimestamp.entries(),
  ].sort(([left], [right]) => left - right)) {
    if (currentValue == null) {
      observedFrom = timestamp;
      initialValue = observation.value;
      currentValue = observation.value;
      continue;
    }
    if (observation.value === currentValue) continue;
    if (timestamp >= startTime) {
      changes.push({
        timestamp,
        previousValue: currentValue,
        value: observation.value,
      });
    }
    currentValue = observation.value;
  }
  return { observedFrom, initialValue, changes };
};

export const isRuntimeStrategyLineageScope = (
  value: unknown,
): value is RuntimeStrategyLineageScope => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const lineage = record.lineage as Record<string, unknown> | undefined;
  return (
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.firstTimestamp === 'number' &&
    Number.isFinite(record.firstTimestamp) &&
    typeof record.lastTimestamp === 'number' &&
    Number.isFinite(record.lastTimestamp) &&
    lineage != null &&
    lineage.schemaVersion === 3 &&
    typeof lineage.strategyRevision === 'string' &&
    /^sr1:[a-f0-9]{16}$/.test(lineage.strategyRevision) &&
    typeof lineage.deploymentCompositionId === 'string' &&
    /^dc1:[a-f0-9]{16}$/.test(lineage.deploymentCompositionId) &&
    typeof lineage.strategyPackageVersion === 'string' &&
    lineage.strategyPackageVersion.trim().length > 0 &&
    typeof lineage.runtimePackageVersion === 'string' &&
    lineage.runtimePackageVersion.trim().length > 0 &&
    lineage.strategyDependencyVersions != null &&
    typeof lineage.strategyDependencyVersions === 'object'
  );
};
