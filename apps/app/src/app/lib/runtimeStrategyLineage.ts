import type {
  MarketUniverse,
  RuntimeLineage,
  RuntimeTradeRecord,
} from '@tradejs/types';

export interface RuntimeStrategyLineageScope {
  strategy: string;
  symbol: string;
  runtimeConfigId?: string;
  lineage: RuntimeLineage & { maxLossValue?: number | null };
  firstTimestamp: number;
  lastTimestamp: number;
}

export interface RuntimeStrategyAiGateChange {
  timestamp: number;
  previousFingerprint: string;
  fingerprint: string;
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

export interface RuntimeStrategyAccountScope {
  strategyName: string;
  configId: string;
  universe: MarketUniverse;
  accountId?: string;
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

export const assignLegacyRuntimeTradeAccountScopes = (
  trades: RuntimeTradeRecord[],
  scopes: RuntimeStrategyAccountScope[],
): RuntimeTradeRecord[] =>
  trades.map((trade) => {
    if (trade.accountId || trade.deploymentId) return trade;
    const matchingAccountIds = new Set(
      scopes
        .filter(
          (scope) =>
            scope.strategyName === trade.strategy &&
            scope.configId === (trade.runtimeConfigId ?? 'config') &&
            scope.universe === (trade.universe ?? 'crypto'),
        )
        .map((scope) => scope.accountId)
        .filter((accountId): accountId is string => Boolean(accountId)),
    );
    return matchingAccountIds.size === 1
      ? { ...trade, accountId: [...matchingAccountIds][0] }
      : trade;
  });

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
    typeof lineage.gateFingerprint === 'string' &&
    lineage.gateFingerprint.trim().length > 0
  );
};

export const buildRuntimeStrategyAiGateChanges = ({
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
}): RuntimeStrategyAiGateChange[] => {
  const normalizedConfigId = configId ?? 'config';
  const observationsByTimestamp = new Map<
    number,
    { fingerprint: string; lastTimestamp: number }
  >();
  for (const scope of scopes) {
    if (
      scope.strategy !== strategyName ||
      (scope.runtimeConfigId ?? 'config') !== normalizedConfigId ||
      scope.firstTimestamp > endTime
    ) {
      continue;
    }
    const fingerprint = scope.lineage.gateFingerprint.trim();
    const existing = observationsByTimestamp.get(scope.firstTimestamp);
    if (
      !existing ||
      scope.lastTimestamp > existing.lastTimestamp ||
      (scope.lastTimestamp === existing.lastTimestamp &&
        fingerprint > existing.fingerprint)
    ) {
      observationsByTimestamp.set(scope.firstTimestamp, {
        fingerprint,
        lastTimestamp: scope.lastTimestamp,
      });
    }
  }

  const changes: RuntimeStrategyAiGateChange[] = [];
  let currentFingerprint: string | null = null;
  for (const [timestamp, observation] of [
    ...observationsByTimestamp.entries(),
  ].sort(([left], [right]) => left - right)) {
    if (currentFingerprint == null) {
      currentFingerprint = observation.fingerprint;
      continue;
    }
    if (observation.fingerprint === currentFingerprint) continue;
    if (timestamp >= startTime) {
      changes.push({
        timestamp,
        previousFingerprint: currentFingerprint,
        fingerprint: observation.fingerprint,
      });
    }
    currentFingerprint = observation.fingerprint;
  }
  return changes;
};
