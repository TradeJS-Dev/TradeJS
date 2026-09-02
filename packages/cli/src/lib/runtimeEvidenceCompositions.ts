import type { RuntimeLineage } from '@tradejs/types';
import {
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
} from './runtimeEvidenceArtifacts';
import {
  activeRuntimeEvidenceStrategies,
  parseRuntimeEvidenceDeploymentSnapshot,
  runtimeLineageMatchesStrategySnapshot,
  type RuntimeEvidenceDeploymentSnapshot,
} from './runtimeEvidenceDeployment';
import {
  parseRuntimeEvidenceProducer,
  type RuntimeEvidenceProducer,
} from './runtimeEvidenceProducer';
import type { RuntimeDebugEvidence } from './runtimeDebugEvidence';

export type RuntimeEvidenceCompositionSnapshot = {
  deployment: RuntimeEvidenceDeploymentSnapshot;
  producer: RuntimeEvidenceProducer | null;
};

const stableSnapshotIdentity = (
  deployment: RuntimeEvidenceDeploymentSnapshot,
) => JSON.stringify({ ...deployment, tickers: undefined });

const producerIdentity = (producer: RuntimeEvidenceProducer | null) =>
  JSON.stringify(producer);

export const loadRuntimeEvidenceCompositionSnapshots = async ({
  publishRoot,
  currentDeployment,
  currentProducer,
}: {
  publishRoot: string;
  currentDeployment: RuntimeEvidenceDeploymentSnapshot;
  currentProducer: RuntimeEvidenceProducer;
}) => {
  const snapshots = new Map<string, RuntimeEvidenceCompositionSnapshot>();
  const register = (snapshot: RuntimeEvidenceCompositionSnapshot) => {
    const compositionId = snapshot.deployment.deploymentCompositionId;
    const known = snapshots.get(compositionId);
    if (
      known &&
      (stableSnapshotIdentity(known.deployment) !==
        stableSnapshotIdentity(snapshot.deployment) ||
        producerIdentity(known.producer) !==
          producerIdentity(snapshot.producer))
    ) {
      throw new Error(
        `Conflicting runtime evidence snapshot for composition ${compositionId}`,
      );
    }
    snapshots.set(compositionId, snapshot);
  };

  const bundleDirs = await discoverRuntimeEvidenceBundles(publishRoot);
  for (const bundleDir of bundleDirs) {
    const bundle = await verifyRuntimeEvidenceBundle(bundleDir);
    const deployment = parseRuntimeEvidenceDeploymentSnapshot(
      bundle.artifact.deployment,
    );
    if (deployment.id !== currentDeployment.id) continue;
    // Older debug-only bundles were published before image identity became
    // mandatory. They cannot support an exact historical replay, but they
    // must not prevent newer image-bound snapshots from being discovered.
    if (bundle.artifact.producer == null) continue;
    register({
      deployment: { ...deployment, tickers: undefined },
      producer: parseRuntimeEvidenceProducer(bundle.artifact.producer),
    });
  }

  const historicalCurrent = snapshots.get(
    currentDeployment.deploymentCompositionId,
  );
  if (
    historicalCurrent &&
    stableSnapshotIdentity(historicalCurrent.deployment) !==
      stableSnapshotIdentity(currentDeployment)
  ) {
    throw new Error(
      `Current runtime deployment conflicts with stored composition ${currentDeployment.deploymentCompositionId}`,
    );
  }
  snapshots.set(currentDeployment.deploymentCompositionId, {
    deployment: { ...currentDeployment, tickers: undefined },
    producer: currentProducer,
  });

  return snapshots;
};

const rowCompositionId = (row: {
  runtimeLineage?: { deploymentCompositionId?: string };
  lineage?: { deploymentCompositionId?: string };
}) =>
  row.runtimeLineage?.deploymentCompositionId ??
  row.lineage?.deploymentCompositionId ??
  null;

const rowTimestamp = (row: Record<string, unknown>) => {
  for (const field of [
    'firstTimestamp',
    'entryTimestamp',
    'timestamp',
    'lastTimestamp',
  ]) {
    const value = row[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return Number.POSITIVE_INFINITY;
};

const belongsToSnapshot = (
  row: {
    strategy: string;
    deploymentId?: string;
    accountId?: string;
    runtimeLineage?: RuntimeLineage;
    lineage?: RuntimeLineage;
  },
  deployment: RuntimeEvidenceDeploymentSnapshot,
) => {
  const strategy = activeRuntimeEvidenceStrategies(deployment).find(
    (candidate) => candidate.strategyName === row.strategy,
  );
  return Boolean(
    strategy &&
      row.deploymentId === deployment.id &&
      row.accountId === deployment.accountId &&
      runtimeLineageMatchesStrategySnapshot({
        lineage: row.runtimeLineage ?? row.lineage,
        deployment,
        strategy,
      }),
  );
};

export const splitRuntimeEvidenceByComposition = ({
  evidence,
  snapshots,
  includeEmptyCompositionIds = [],
  ignoreUnknownCompositions = false,
}: {
  evidence: RuntimeDebugEvidence;
  snapshots: Map<string, RuntimeEvidenceCompositionSnapshot>;
  includeEmptyCompositionIds?: string[];
  ignoreUnknownCompositions?: boolean;
}) => {
  const observed = new Set<string>();
  for (const row of [
    ...evidence.trades,
    ...evidence.signals,
    ...evidence.evaluations,
    ...evidence.lineageScopes,
  ]) {
    const compositionId = rowCompositionId(row);
    if (compositionId) observed.add(compositionId);
  }
  for (const compositionId of includeEmptyCompositionIds) {
    observed.add(compositionId);
  }

  const missing = [...observed].filter(
    (compositionId) => !snapshots.has(compositionId),
  );
  if (missing.length && !ignoreUnknownCompositions) {
    throw new Error(
      `Runtime evidence has no verified deployment snapshot for composition(s): ${missing.sort().join(', ')}`,
    );
  }

  return [...observed]
    .filter((compositionId) => snapshots.has(compositionId))
    .map((compositionId) => snapshots.get(compositionId)!)
    .map(({ deployment, producer }) => {
      const trades = evidence.trades.filter((row) =>
        belongsToSnapshot(row, deployment),
      );
      const signals = evidence.signals.filter((row) =>
        belongsToSnapshot(row, deployment),
      );
      const evaluations = evidence.evaluations.filter((row) =>
        belongsToSnapshot(row, deployment),
      );
      const lineageScopes = evidence.lineageScopes.filter((row) =>
        belongsToSnapshot(row, deployment),
      );
      const timestamps = [
        ...trades,
        ...signals,
        ...evaluations,
        ...lineageScopes,
      ].map((row) => rowTimestamp(row as unknown as Record<string, unknown>));

      return {
        deployment,
        producer,
        trades,
        signals,
        evaluations,
        lineageScopes,
        firstTimestamp: Math.min(...timestamps),
      };
    })
    .sort(
      (left, right) =>
        left.firstTimestamp - right.firstTimestamp ||
        left.deployment.deploymentCompositionId.localeCompare(
          right.deployment.deploymentCompositionId,
        ),
    );
};
