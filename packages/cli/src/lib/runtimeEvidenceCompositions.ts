import type { RuntimeLineage } from '@tradejs/types';
import {
  discoverRuntimeEvidenceBundles,
  verifyRuntimeEvidenceBundle,
} from './runtimeEvidenceArtifacts';
import { discoverRuntimeEvidenceCompositionSnapshots } from './runtimeEvidenceCompositionSnapshots';
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
  fallbackTickers?: string[];
  producerVariants?: RuntimeEvidenceProducer[];
};

const stableSnapshotIdentity = (
  deployment: RuntimeEvidenceDeploymentSnapshot,
) =>
  JSON.stringify({
    ...deployment,
    tickers: undefined,
    strategies: deployment.strategies.map((strategy) => ({
      ...strategy,
      controlState: undefined,
    })),
  });

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
      stableSnapshotIdentity(known.deployment) !==
        stableSnapshotIdentity(snapshot.deployment)
    ) {
      throw new Error(
        `Conflicting runtime evidence snapshot for composition ${compositionId}`,
      );
    }
    // A composition can survive a Project image change. Retain every exact
    // producer instead of selecting whichever historical bundle was read last.
    const producers = new Map<string, RuntimeEvidenceProducer>();
    for (const source of [
      ...(known?.producerVariants ?? []),
      known?.producer,
      snapshot.producer,
    ]) {
      if (source) producers.set(producerIdentity(source), source);
    }
    const producerVariants = [...producers.values()];
    snapshots.set(compositionId, {
      ...known,
      ...snapshot,
      producer: producerVariants.length === 1 ? producerVariants[0]! : null,
      ...(producerVariants.length > 1 ? { producerVariants } : {}),
    });
  };

  const compositionSnapshots =
    await discoverRuntimeEvidenceCompositionSnapshots(publishRoot);
  for (const snapshot of compositionSnapshots) {
    if (snapshot.deployment.id !== currentDeployment.id) continue;
    register({
      deployment: snapshot.deployment,
      producer: snapshot.producer,
    });
  }

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
      // A historical composition may reappear through a position that closes
      // in this window even without current-window lineage scopes. Its latest
      // checksum-verified universe is only a fallback; fresh scopes win.
      ...(deployment.tickers?.length
        ? { fallbackTickers: [...deployment.tickers] }
        : {}),
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
  register({
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

  // Runtime lineage v3 has no producer image field. If this window actually
  // uses an ambiguous composition, neither a latest-image guess nor the
  // collector's current image can establish its execution provenance.
  for (const compositionId of observed) {
    const variants = snapshots.get(compositionId)?.producerVariants;
    if (variants && variants.length > 1) {
      throw new Error(
        `Ambiguous runtime evidence producer for composition ${compositionId}: ${variants
          .map((source) => `${source.projectSha}@${source.imageDigest}`)
          .sort()
          .join(', ')}; runtime lineage has no producer image identity`,
      );
    }
  }

  return [...observed]
    .filter((compositionId) => snapshots.has(compositionId))
    .map((compositionId) => snapshots.get(compositionId)!)
    .map(({ deployment, producer, fallbackTickers }) => {
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
        ...(fallbackTickers ? { fallbackTickers } : {}),
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
