import type { RuntimeLineage } from '@tradejs/types';
import { runtimeLineageKey } from './runtimeLineage';

type JsonRecord = Record<string, unknown>;

export type RuntimeScorecardThresholds = {
  minimumParityRatio: number;
  maximumSlippageResidualBps: number;
  minimumClosedTrades: number;
  minimumExpectancy: number;
};

export type RuntimeScorecard = ReturnType<typeof buildRuntimeScorecard>;

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const finiteString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const packageVersionMap = (value: unknown): Record<string, string> | null => {
  const record = asRecord(value);
  if (!record || Object.keys(record).length === 0) return null;
  const entries = Object.entries(record);
  if (
    entries.some(
      ([name, version]) =>
        !name.startsWith('@tradejs/') || finiteString(version) == null,
    )
  ) {
    return null;
  }
  return Object.fromEntries(
    entries
      .map(([name, version]) => [name, String(version).trim()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
};

const round = (value: number, decimals = 6) => Number(value.toFixed(decimals));

const unwrapRows = (value: unknown, key: string) =>
  asArray(value)
    .map((item) => asRecord(asRecord(item)?.[key]) ?? asRecord(item))
    .filter((item): item is JsonRecord => item != null);

const runtimePayload = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return asRecord(root.runtime) ?? root;
};

const runtimeWindow = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return (
    asRecord(root.window) ?? asRecord(runtimePayload(artifact).window) ?? {}
  );
};

const extractRuntimeRows = (artifact: unknown) => {
  const runtime = runtimePayload(artifact);
  return {
    evaluations: unwrapRows(runtime.evaluations, 'evaluation'),
    signals: unwrapRows(runtime.signals, 'signal'),
    trades: unwrapRows(runtime.trades, 'trade'),
    lineageScopes: unwrapRows(runtime.lineageScopes, 'lineageScope'),
    statsBuckets: asArray(runtime.evaluationStatsBuckets)
      .map(asRecord)
      .filter((item): item is JsonRecord => item != null),
  };
};

const buildRuntimeLineageSummary = (rows: {
  evaluations: JsonRecord[];
  signals: JsonRecord[];
  trades: JsonRecord[];
  lineageScopes: JsonRecord[];
}) => {
  const lineageRows = [
    ...rows.evaluations,
    ...rows.signals,
    ...rows.trades,
    ...rows.lineageScopes.map((scope) => ({
      runtimeLineage: scope.lineage,
    })),
  ];
  const lineages = lineageRows
    .map((row) => asRecord(row.runtimeLineage))
    .filter((lineage): lineage is JsonRecord => lineage != null);
  const identities = new Map<string, JsonRecord>();
  for (const lineage of lineages) {
    const identity =
      lineage.schemaVersion === 3
        ? {
            schemaVersion: 3,
            strategyRevision: finiteString(lineage.strategyRevision),
            deploymentCompositionId: finiteString(
              lineage.deploymentCompositionId,
            ),
            strategyPackageVersion: finiteString(
              lineage.strategyPackageVersion,
            ),
            strategyDependencyVersions: packageVersionMap(
              lineage.strategyDependencyVersions,
            ),
            runtimePackageVersion: finiteString(lineage.runtimePackageVersion),
            maxLossValue: finiteNumber(lineage.maxLossValue),
          }
        : {
            schemaVersion: 1,
            compositionId: finiteString(lineage.compositionId),
            gitSha: finiteString(lineage.gitSha),
            gitDirty:
              typeof lineage.gitDirty === 'boolean' ? lineage.gitDirty : null,
            gateFingerprint: finiteString(lineage.gateFingerprint),
            configFingerprint: finiteString(lineage.configFingerprint),
            contextFingerprint: finiteString(lineage.contextFingerprint),
            maxLossValue: finiteNumber(lineage.maxLossValue),
          };
    identities.set(JSON.stringify(identity), identity);
  }
  const identity = identities.size === 1 ? [...identities.values()][0] : null;
  const schemaVersion = finiteNumber(identity?.schemaVersion);
  const identityComplete =
    lineages.length > 0 &&
    identity != null &&
    ((schemaVersion === 3 &&
      finiteString(identity.strategyRevision) != null &&
      finiteString(identity.deploymentCompositionId) != null &&
      finiteString(identity.strategyPackageVersion) != null &&
      packageVersionMap(identity.strategyDependencyVersions) != null &&
      finiteString(identity.runtimePackageVersion) != null) ||
      (schemaVersion === 1 &&
        identity.compositionId != null &&
        identity.gitSha != null &&
        identity.gitDirty === false &&
        identity.gateFingerprint != null &&
        identity.configFingerprint != null &&
        identity.contextFingerprint != null)) &&
    identity.maxLossValue != null;
  const coverageComplete =
    lineageRows.length > 0 && lineages.length === lineageRows.length;
  const complete = identityComplete && coverageComplete;
  const lineageKey = identityComplete
    ? runtimeLineageKey(identity as unknown as RuntimeLineage)
    : null;
  return {
    complete,
    identityComplete,
    coverageComplete,
    conflicts: identities.size > 1,
    rows: lineageRows.length,
    rowsWithLineage: lineages.length,
    schemaVersion,
    lineageKey,
    strategyRevision: finiteString(identity?.strategyRevision),
    deploymentCompositionId: finiteString(identity?.deploymentCompositionId),
    strategyPackageVersion: finiteString(identity?.strategyPackageVersion),
    strategyDependencyVersions: packageVersionMap(
      identity?.strategyDependencyVersions,
    ),
    runtimePackageVersion: finiteString(identity?.runtimePackageVersion),
    compositionId: finiteString(identity?.compositionId),
    gitSha: finiteString(identity?.gitSha),
    gitDirty:
      typeof identity?.gitDirty === 'boolean' ? identity.gitDirty : null,
    gateFingerprint: finiteString(identity?.gateFingerprint),
    configFingerprint: finiteString(identity?.configFingerprint),
    contextFingerprint: finiteString(identity?.contextFingerprint),
    maxLossValue: finiteNumber(identity?.maxLossValue),
  };
};

type EmbeddedLineageTarget = {
  strategyName: string;
  strategyRevision: string;
  deploymentCompositionId: string;
  strategyPackageVersion: string;
  strategyDependencyVersions: Record<string, string>;
  runtimePackageVersion: string;
  maxLossValue: number | null;
  rowsWithLineage: number;
  riskConflict: boolean;
};

const buildEmbeddedLineageScope = ({
  artifact,
  rows,
  strategy,
}: {
  artifact: unknown;
  rows: ReturnType<typeof extractRuntimeRows>;
  strategy: string | null;
}) => {
  const deployment = asRecord(asRecord(artifact)?.deployment);
  if (finiteNumber(deployment?.schemaVersion) !== 2) return null;
  const deploymentId = finiteString(deployment?.id);
  const accountId = finiteString(deployment?.accountId);
  const deploymentCompositionId = finiteString(
    deployment?.deploymentCompositionId,
  );
  if (!deploymentId || !accountId || !deploymentCompositionId) return null;

  const snapshots = asArray(deployment?.strategies)
    .map(asRecord)
    .filter((item): item is JsonRecord => item != null)
    .filter((item) => item.enabled === true)
    .filter(
      (item) => !strategy || finiteString(item.strategyName) === strategy,
    );
  const targetSeeds = snapshots
    .map((snapshot) => {
      const strategyName = finiteString(snapshot.strategyName);
      const strategyRevision = finiteString(snapshot.strategyRevision);
      const strategyPackageVersion = finiteString(
        snapshot.strategyPackageVersion,
      );
      const strategyDependencyVersions = packageVersionMap(
        snapshot.strategyDependencyVersions,
      );
      const runtimePackageVersion = finiteString(
        snapshot.runtimePackageVersion,
      );
      return strategyName &&
        strategyRevision &&
        strategyPackageVersion &&
        strategyDependencyVersions &&
        runtimePackageVersion
        ? {
            strategyName,
            strategyRevision,
            deploymentCompositionId,
            strategyPackageVersion,
            strategyDependencyVersions,
            runtimePackageVersion,
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => item != null);
  if (targetSeeds.length !== snapshots.length || targetSeeds.length === 0) {
    return null;
  }

  const lineageRows = [
    ...rows.evaluations,
    ...rows.signals,
    ...rows.trades,
    ...rows.lineageScopes.map((scope) => ({
      strategy: scope.strategy,
      deploymentId: scope.deploymentId,
      accountId: scope.accountId,
      runtimeLineage: scope.lineage,
    })),
  ];
  const identityMatches = (
    lineage: JsonRecord | null,
    target: Omit<
      EmbeddedLineageTarget,
      'maxLossValue' | 'rowsWithLineage' | 'riskConflict'
    >,
  ) =>
    finiteNumber(lineage?.schemaVersion) === 3 &&
    finiteString(lineage?.strategyRevision) === target.strategyRevision &&
    finiteString(lineage?.deploymentCompositionId) ===
      target.deploymentCompositionId &&
    finiteString(lineage?.strategyPackageVersion) ===
      target.strategyPackageVersion &&
    JSON.stringify(packageVersionMap(lineage?.strategyDependencyVersions)) ===
      JSON.stringify(target.strategyDependencyVersions) &&
    finiteString(lineage?.runtimePackageVersion) ===
      target.runtimePackageVersion;
  const targets = new Map<string, EmbeddedLineageTarget>();
  for (const seed of targetSeeds) {
    const matchingRows = lineageRows.filter(
      (row) =>
        finiteString(row.strategy) === seed.strategyName &&
        finiteString(row.deploymentId) === deploymentId &&
        finiteString(row.accountId) === accountId &&
        identityMatches(asRecord(row.runtimeLineage), seed),
    );
    const riskValues = new Set(
      matchingRows
        .map((row) => finiteNumber(asRecord(row.runtimeLineage)?.maxLossValue))
        .filter((value): value is number => value != null),
    );
    targets.set(seed.strategyName, {
      ...seed,
      maxLossValue: riskValues.size === 1 ? [...riskValues][0] : null,
      rowsWithLineage: matchingRows.length,
      riskConflict: riskValues.size > 1,
    });
  }

  const belongs = (row: JsonRecord) => {
    const strategyName = finiteString(row.strategy);
    const target = strategyName ? targets.get(strategyName) : null;
    const lineage = asRecord(row.runtimeLineage);
    return Boolean(
      target &&
        target.maxLossValue != null &&
        identityMatches(lineage, target) &&
        finiteNumber(lineage?.maxLossValue) === target.maxLossValue,
    );
  };
  const targetValues = [...targets.values()];
  const coverageComplete = targetValues.every(
    (target) => target.rowsWithLineage > 0 && target.maxLossValue != null,
  );
  const commonRiskValues = new Set(
    targetValues
      .map((target) => target.maxLossValue)
      .filter((value): value is number => value != null),
  );
  const singleTarget = targetValues.length === 1 ? targetValues[0] : null;
  const singleLineage =
    singleTarget?.maxLossValue != null
      ? ({
          schemaVersion: 3,
          strategyRevision: singleTarget.strategyRevision,
          deploymentCompositionId: singleTarget.deploymentCompositionId,
          strategyPackageVersion: singleTarget.strategyPackageVersion,
          strategyDependencyVersions: singleTarget.strategyDependencyVersions,
          runtimePackageVersion: singleTarget.runtimePackageVersion,
          maxLossValue: singleTarget.maxLossValue,
        } as RuntimeLineage)
      : null;
  return {
    belongs,
    summary: {
      complete: coverageComplete,
      identityComplete: true,
      coverageComplete,
      conflicts: targetValues.some((target) => target.riskConflict),
      rows: lineageRows.length,
      rowsWithLineage: targetValues.reduce(
        (total, target) => total + target.rowsWithLineage,
        0,
      ),
      schemaVersion: 3,
      lineageKey: singleLineage ? runtimeLineageKey(singleLineage) : null,
      strategyRevision: singleTarget?.strategyRevision ?? null,
      deploymentCompositionId,
      strategyPackageVersion: singleTarget?.strategyPackageVersion ?? null,
      strategyDependencyVersions:
        singleTarget?.strategyDependencyVersions ?? null,
      runtimePackageVersion: singleTarget?.runtimePackageVersion ?? null,
      compositionId: null,
      gitSha: null,
      gitDirty: null,
      gateFingerprint: null,
      configFingerprint: null,
      contextFingerprint: null,
      maxLossValue:
        commonRiskValues.size === 1 ? [...commonRiskValues][0] : null,
      strategyScopes: Object.fromEntries(
        targetValues.map((target) => [
          target.strategyName,
          {
            strategyRevision: target.strategyRevision,
            rowsWithLineage: target.rowsWithLineage,
            maxLossValue: target.maxLossValue,
            complete: target.rowsWithLineage > 0 && target.maxLossValue != null,
          },
        ]),
      ),
    },
  };
};

const belongsToRuntimeLineage = (
  row: JsonRecord,
  summary: ReturnType<typeof buildRuntimeLineageSummary>,
) => {
  if (!summary.identityComplete || !summary.lineageKey) return false;
  const lineage = asRecord(row.runtimeLineage);
  if (!lineage) return false;
  return (
    runtimeLineageKey(lineage as unknown as RuntimeLineage) ===
      summary.lineageKey &&
    finiteNumber(lineage.maxLossValue) === summary.maxLossValue
  );
};

const runtimeDeploymentBinding = (artifact: unknown) => {
  const deployment = asRecord(asRecord(artifact)?.deployment);
  return {
    deploymentId: finiteString(deployment?.id),
    accountId: finiteString(deployment?.accountId),
  };
};

const belongsToRuntimeDeployment = (
  row: JsonRecord,
  binding: ReturnType<typeof runtimeDeploymentBinding>,
) =>
  binding.deploymentId == null && binding.accountId == null
    ? true
    : finiteString(row.deploymentId) === binding.deploymentId &&
      finiteString(row.accountId) === binding.accountId;

const belongsToStrategy = (row: JsonRecord, strategy: string | null) =>
  strategy == null || finiteString(row.strategy) === strategy;

const filterArtifactByStrategy = (
  artifact: unknown,
  strategy: string | null,
) => {
  if (!strategy) return artifact;
  const root = asRecord(artifact) ?? {};
  const runtime = runtimePayload(artifact);
  return {
    ...root,
    runtime: {
      ...runtime,
      evaluations: asArray(runtime.evaluations).filter((item) =>
        belongsToStrategy(
          asRecord(asRecord(item)?.evaluation) ?? asRecord(item) ?? {},
          strategy,
        ),
      ),
      signals: asArray(runtime.signals).filter((item) =>
        belongsToStrategy(
          asRecord(asRecord(item)?.signal) ?? asRecord(item) ?? {},
          strategy,
        ),
      ),
      trades: asArray(runtime.trades).filter((item) =>
        belongsToStrategy(
          asRecord(asRecord(item)?.trade) ?? asRecord(item) ?? {},
          strategy,
        ),
      ),
      lineageScopes: asArray(runtime.lineageScopes).filter((item) =>
        belongsToStrategy(asRecord(item) ?? {}, strategy),
      ),
      evaluationStatsBuckets: asArray(runtime.evaluationStatsBuckets).filter(
        (item) => belongsToStrategy(asRecord(item) ?? {}, strategy),
      ),
    },
  };
};

const countBy = (
  items: JsonRecord[],
  getter: (item: JsonRecord) => string | null,
) => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = getter(item);
    if (!key) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
};

const buildDistributions = ({
  evaluations,
  signals,
}: {
  evaluations: JsonRecord[];
  signals: JsonRecord[];
}) => {
  const candidates = evaluations.filter(
    (evaluation) => evaluation.status === 'signal',
  );
  return {
    candidatesByStrategy: countBy(candidates, (evaluation) =>
      finiteString(evaluation.strategy),
    ),
    orderStatus: countBy(signals, (signal) => finiteString(signal.orderStatus)),
    skipReasons: countBy(signals, (signal) =>
      finiteString(signal.orderSkipReason),
    ),
    aiQuality: countBy(candidates, (evaluation) => {
      const quality = finiteNumber(asRecord(evaluation.aiAnalysis)?.quality);
      return quality == null ? null : String(quality);
    }),
  };
};

const buildDistributionDelta = (
  current: Record<string, number>,
  previous: Record<string, number>,
) => {
  const currentTotal = Object.values(current).reduce(
    (total, value) => total + value,
    0,
  );
  const previousTotal = Object.values(previous).reduce(
    (total, value) => total + value,
    0,
  );
  const keys = [
    ...new Set([...Object.keys(current), ...Object.keys(previous)]),
  ].sort((left, right) => left.localeCompare(right));

  return Object.fromEntries(
    keys.map((key) => {
      const currentCount = current[key] ?? 0;
      const previousCount = previous[key] ?? 0;
      const currentShare = currentTotal > 0 ? currentCount / currentTotal : 0;
      const previousShare =
        previousTotal > 0 ? previousCount / previousTotal : 0;
      return [
        key,
        {
          currentCount,
          previousCount,
          currentShare: round(currentShare),
          previousShare: round(previousShare),
          shareDelta: round(currentShare - previousShare),
        },
      ];
    }),
  );
};

const sum = (values: Array<number | null>) =>
  round(values.reduce<number>((total, value) => total + (value ?? 0), 0));

const statsCount = (buckets: JsonRecord[], field: string) =>
  sum(buckets.map((bucket) => finiteNumber(asRecord(bucket.stats)?.[field])));

const tradeTimestamp = (trade: JsonRecord) =>
  finiteNumber(trade.exitTimestamp) ??
  finiteNumber(trade.lastSyncedAt) ??
  finiteNumber(trade.entryTimestamp) ??
  0;

const dedupeTrades = (artifacts: unknown[]) => {
  const tradesByOrderId = new Map<string, JsonRecord>();
  for (const artifact of artifacts) {
    for (const trade of extractRuntimeRows(artifact).trades) {
      const orderId = finiteString(trade.orderId);
      if (!orderId) continue;
      const existing = tradesByOrderId.get(orderId);
      if (!existing || tradeTimestamp(trade) >= tradeTimestamp(existing)) {
        tradesByOrderId.set(orderId, trade);
      }
    }
  }
  return [...tradesByOrderId.values()];
};

const maxDrawdown = (trades: JsonRecord[]) => {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const trade of trades.sort(
    (left, right) => tradeTimestamp(left) - tradeTimestamp(right),
  )) {
    cumulative += finiteNumber(trade.closedPnl) ?? 0;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return round(drawdown);
};

const buildRollingPerformance = ({
  trades,
  anchorTime,
  days,
}: {
  trades: JsonRecord[];
  anchorTime: number;
  days: number;
}) => {
  const startTime = anchorTime - days * 24 * 60 * 60 * 1000;
  const closed = trades.filter((trade) => {
    const exitTimestamp = finiteNumber(trade.exitTimestamp);
    return (
      trade.status === 'closed' &&
      exitTimestamp != null &&
      exitTimestamp >= startTime &&
      exitTimestamp < anchorTime
    );
  });
  const realizedPnl = sum(closed.map((trade) => finiteNumber(trade.closedPnl)));
  return {
    days,
    closedTrades: closed.length,
    realizedPnl,
    expectancy: closed.length > 0 ? round(realizedPnl / closed.length) : null,
    maxDrawdown: maxDrawdown(closed),
  };
};

const getReplayComparison = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return asRecord(asRecord(root.replay)?.runtimeComparison) ?? null;
};

const replayCountsForStrategy = (
  replayComparison: JsonRecord | null,
  strategy: string | null,
) => {
  if (strategy) {
    const byStrategy = asRecord(replayComparison?.byStrategy);
    const strategyCounts = asRecord(byStrategy?.[strategy]);
    if (strategyCounts) {
      return {
        matched: finiteNumber(strategyCounts.matched) ?? 0,
        backtestOnly: finiteNumber(strategyCounts.backtestOnly) ?? 0,
        runtimeOnly: finiteNumber(strategyCounts.runtimeOnly) ?? 0,
      };
    }
  }
  const counts = asRecord(replayComparison?.counts);
  return {
    matched: finiteNumber(counts?.matched) ?? 0,
    backtestOnly: finiteNumber(counts?.backtestOnly) ?? 0,
    runtimeOnly: finiteNumber(counts?.runtimeOnly) ?? 0,
  };
};

const getCalibrationSummary = (artifact: unknown) => {
  const root = asRecord(artifact) ?? {};
  return asRecord(asRecord(root.summary)?.all) ?? null;
};

const getProspectiveSummary = (artifact: unknown) => {
  const root = asRecord(artifact);
  if (!root || root.reportType !== 'strategy-prospective-evidence') return null;
  return {
    rawCoreExpectancy: finiteNumber(root.rawCoreExpectancy),
    aiGateExpectancy: finiteNumber(root.aiGateExpectancy),
    regimeCoverage: finiteNumber(root.regimeCoverage),
  };
};

export const buildRuntimeScorecard = ({
  runtimeArtifact,
  replayEvidenceArtifact,
  calibrationArtifact,
  prospectiveEvidenceArtifact,
  historyRuntimeArtifacts = [],
  thresholds = {
    minimumParityRatio: 0.95,
    maximumSlippageResidualBps: 3,
    minimumClosedTrades: 20,
    minimumExpectancy: 0,
  },
  generatedAt = Date.now(),
  strategy = null,
  llmComparatorPolicy = 'ai_approved_only',
}: {
  runtimeArtifact: unknown;
  replayEvidenceArtifact?: unknown;
  calibrationArtifact?: unknown;
  prospectiveEvidenceArtifact?: unknown;
  historyRuntimeArtifacts?: unknown[];
  thresholds?: RuntimeScorecardThresholds;
  generatedAt?: number;
  strategy?: string | null;
  llmComparatorPolicy?: 'ai_approved_only' | 'all_core_candidates' | 'disabled';
}) => {
  const scopedRuntimeArtifact = filterArtifactByStrategy(
    runtimeArtifact,
    strategy,
  );
  const scopedHistoryArtifacts = historyRuntimeArtifacts.map((artifact) =>
    filterArtifactByStrategy(artifact, strategy),
  );
  const deploymentBinding = runtimeDeploymentBinding(runtimeArtifact);
  const rows = extractRuntimeRows(scopedRuntimeArtifact);
  const embeddedLineageScope = buildEmbeddedLineageScope({
    artifact: runtimeArtifact,
    rows,
    strategy,
  });
  const runtimeLineage =
    embeddedLineageScope?.summary ?? buildRuntimeLineageSummary(rows);
  const window = runtimeWindow(runtimeArtifact);
  const startTime = finiteNumber(window.startTime) ?? generatedAt - 86_400_000;
  const endTime = finiteNumber(window.endTime) ?? generatedAt;
  const evaluationsFromStats = statsCount(rows.statsBuckets, 'evaluated');
  const candidatesFromStats = statsCount(rows.statsBuckets, 'signals');
  const signalEvaluations = rows.evaluations.filter(
    (evaluation) => evaluation.status === 'signal',
  );
  const gateDecisions = signalEvaluations
    .map((evaluation) => ({
      evaluation,
      decision: finiteString(asRecord(evaluation.aiAnalysis)?.gateDecision),
    }))
    .filter(
      ({ decision }) => decision === 'approved' || decision === 'rejected',
    );
  const llmEligibleEvaluations =
    llmComparatorPolicy === 'disabled'
      ? []
      : llmComparatorPolicy === 'ai_approved_only'
        ? signalEvaluations.filter(
            (evaluation) =>
              finiteString(asRecord(evaluation.aiAnalysis)?.gateDecision) ===
              'approved',
          )
        : signalEvaluations;
  const gateComparisons = llmEligibleEvaluations
    .map((evaluation) => {
      const analysis = asRecord(evaluation.aiAnalysis);
      const gateDecision = finiteString(analysis?.gateDecision);
      const llmDecision = finiteString(analysis?.llmDecision);
      if (
        (gateDecision !== 'approved' && gateDecision !== 'rejected') ||
        (llmDecision !== 'approved' && llmDecision !== 'rejected')
      ) {
        return null;
      }
      return { gateDecision, llmDecision };
    })
    .filter((comparison): comparison is NonNullable<typeof comparison> =>
      Boolean(comparison),
    );
  const allocatorDecisions = signalEvaluations
    .map((evaluation) => asRecord(evaluation.allocatorDecision))
    .filter((item): item is JsonRecord => item != null);
  const riskDecisions = signalEvaluations
    .map((evaluation) => asRecord(evaluation.riskDecision))
    .filter((item): item is JsonRecord => item != null);
  const orderAttempts = rows.signals.filter(
    (signal) =>
      signal.orderStatus === 'completed' || signal.orderStatus === 'failed',
  );
  const currentClosedTrades = rows.trades.filter((trade) => {
    const exitTimestamp = finiteNumber(trade.exitTimestamp);
    return (
      trade.status === 'closed' &&
      exitTimestamp != null &&
      exitTimestamp >= startTime &&
      exitTimestamp < endTime
    );
  });
  const replayComparison = getReplayComparison(replayEvidenceArtifact);
  const replayCounts = replayCountsForStrategy(replayComparison, strategy);
  const matched = replayCounts.matched;
  const backtestOnly = replayCounts.backtestOnly;
  const runtimeOnly = replayCounts.runtimeOnly;
  const comparisonTotal = matched + backtestOnly + runtimeOnly;
  const parityRatio = comparisonTotal > 0 ? matched / comparisonTotal : null;
  const lineage = asRecord(replayComparison?.lineage);
  const lineageReason = finiteString(lineage?.reason);
  const calibrationRoot = asRecord(calibrationArtifact) ?? {};
  const calibrationSummary = asRecord(calibrationRoot.summary);
  const calibrationSamples = asArray(calibrationRoot.samples)
    .map(asRecord)
    .filter((item): item is JsonRecord => item != null)
    .filter((item) => !strategy || finiteString(item.strategy) === strategy)
    .filter(
      (item) => !embeddedLineageScope || embeddedLineageScope.belongs(item),
    );
  const averageSampleMetric = (field: string) => {
    const values = calibrationSamples
      .map((sample) => finiteNumber(sample[field]))
      .filter((value): value is number => value != null);
    return values.length ? round(sum(values) / values.length) : null;
  };
  const fallbackCalibration = strategy
    ? asRecord(asRecord(calibrationSummary?.byStrategy)?.[strategy])
    : getCalibrationSummary(calibrationArtifact);
  const actualSlippageBps = embeddedLineageScope
    ? averageSampleMetric('signalToFillAdverseBps')
    : finiteNumber(asRecord(fallbackCalibration?.signalToFillAdverseBps)?.avg);
  const residualVsModelBps = embeddedLineageScope
    ? averageSampleMetric('residualVsCurrentModelBps')
    : finiteNumber(
        asRecord(fallbackCalibration?.residualVsCurrentModelBps)?.avg,
      );
  const prospective = getProspectiveSummary(prospectiveEvidenceArtifact);
  const historyTrades = dedupeTrades([
    ...scopedHistoryArtifacts,
    scopedRuntimeArtifact,
  ]);
  const comparableHistoryTrades = historyTrades.filter(
    (trade) =>
      belongsToRuntimeDeployment(trade, deploymentBinding) &&
      (embeddedLineageScope
        ? embeddedLineageScope.belongs(trade)
        : belongsToRuntimeLineage(trade, runtimeLineage)),
  );
  const comparableCurrentClosedTrades = currentClosedTrades.filter(
    (trade) =>
      belongsToRuntimeDeployment(trade, deploymentBinding) &&
      (embeddedLineageScope
        ? embeddedLineageScope.belongs(trade)
        : belongsToRuntimeLineage(trade, runtimeLineage)),
  );
  const comparableFills = rows.trades.filter(
    (trade) =>
      belongsToRuntimeDeployment(trade, deploymentBinding) &&
      (embeddedLineageScope
        ? embeddedLineageScope.belongs(trade)
        : belongsToRuntimeLineage(trade, runtimeLineage)),
  );
  const currentDistributions = buildDistributions(rows);
  const previousArtifact = scopedHistoryArtifacts
    .map((artifact) => ({ artifact, window: runtimeWindow(artifact) }))
    .filter(({ window: candidateWindow }) => {
      const candidateEndTime = finiteNumber(candidateWindow.endTime);
      return candidateEndTime != null && candidateEndTime <= startTime;
    })
    .sort(
      (left, right) =>
        (finiteNumber(right.window.endTime) ?? 0) -
        (finiteNumber(left.window.endTime) ?? 0),
    )[0];
  const previousDistributions = previousArtifact
    ? buildDistributions(extractRuntimeRows(previousArtifact.artifact))
    : null;
  const rolling = [7, 30, 90].map((days) =>
    buildRollingPerformance({
      trades: [...comparableHistoryTrades],
      anchorTime: endTime,
      days,
    }),
  );
  const sevenDay = rolling[0];
  const reactions: Array<{
    code: string;
    severity: 'info' | 'warning' | 'blocking';
    message: string;
  }> = [];

  if (lineageReason) {
    reactions.push({
      code: 'LINEAGE_NOT_COMPARABLE',
      severity: 'blocking',
      message: lineageReason,
    });
  }
  if (!runtimeLineage.complete) {
    reactions.push({
      code: 'RUNTIME_LINEAGE_INCOMPLETE',
      severity: 'blocking',
      message: 'Runtime rows do not share one complete composition lineage.',
    });
  }
  if (parityRatio != null && parityRatio < thresholds.minimumParityRatio) {
    reactions.push({
      code: 'PARITY_REGRESSION',
      severity: 'blocking',
      message: `Parity ${round(parityRatio * 100, 2)}% is below ${round(thresholds.minimumParityRatio * 100, 2)}%.`,
    });
  }
  if (
    residualVsModelBps != null &&
    residualVsModelBps > thresholds.maximumSlippageResidualBps
  ) {
    reactions.push({
      code: 'SLIPPAGE_DRIFT',
      severity: 'warning',
      message: `Execution residual ${round(residualVsModelBps, 2)} bps exceeds ${thresholds.maximumSlippageResidualBps} bps.`,
    });
  }
  if (
    sevenDay.closedTrades >= thresholds.minimumClosedTrades &&
    sevenDay.expectancy != null &&
    sevenDay.expectancy < thresholds.minimumExpectancy
  ) {
    reactions.push({
      code: 'EXPECTANCY_DEGRADATION',
      severity: 'blocking',
      message: `7d expectancy ${sevenDay.expectancy} is below ${thresholds.minimumExpectancy}.`,
    });
  }
  if (sevenDay.closedTrades < thresholds.minimumClosedTrades) {
    reactions.push({
      code: 'INSUFFICIENT_RECENT_SAMPLE',
      severity: 'info',
      message: `Only ${sevenDay.closedTrades} closed trades in 7d; ${thresholds.minimumClosedTrades} required for expectancy reaction.`,
    });
  }

  const promotionStatus = reactions.some(
    (reaction) => reaction.severity === 'blocking',
  )
    ? 'PROMOTION_BLOCKED'
    : reactions.some((reaction) => reaction.severity === 'warning')
      ? 'REVIEW_REQUIRED'
      : 'OBSERVE';

  return {
    reportType: 'runtime-scorecard' as const,
    schemaVersion: 1,
    generatedAt,
    window: { startTime, endTime },
    strategy,
    deployment: deploymentBinding,
    lineage: runtimeLineage,
    promotionStatus,
    thresholds,
    funnel: {
      evaluations:
        evaluationsFromStats > 0
          ? evaluationsFromStats
          : rows.evaluations.length,
      coreCandidates:
        candidatesFromStats > 0
          ? candidatesFromStats
          : signalEvaluations.length,
      gate: {
        available: gateDecisions.length > 0,
        approved: gateDecisions.filter(
          ({ decision }) => decision === 'approved',
        ).length,
        rejected: gateDecisions.filter(
          ({ decision }) => decision === 'rejected',
        ).length,
        coverage: signalEvaluations.length
          ? round(gateDecisions.length / signalEvaluations.length)
          : null,
      },
      allocator: {
        available: allocatorDecisions.length > 0,
        approved: allocatorDecisions.filter(
          (decision) => decision.decision === 'approved',
        ).length,
        rejected: allocatorDecisions.filter(
          (decision) => decision.decision === 'rejected',
        ).length,
      },
      risk: {
        available: riskDecisions.length > 0,
        approved: riskDecisions.filter(
          (decision) => decision.decision === 'approved',
        ).length,
        rejected: riskDecisions.filter(
          (decision) => decision.decision === 'rejected',
        ).length,
      },
      orderAttempts: orderAttempts.length,
      orderFailures: orderAttempts.filter(
        (signal) => signal.orderStatus === 'failed',
      ).length,
      balanceRejects: rows.signals.filter((signal) =>
        /BALANCE|MARGIN/i.test(
          `${finiteString(signal.orderSkipReason) ?? ''} ${finiteString(signal.orderFailureReason) ?? ''}`,
        ),
      ).length,
      fills: comparableFills.length,
      nonComparableFills: rows.trades.length - comparableFills.length,
      closedTrades: currentClosedTrades.length,
      comparableClosedTrades: comparableCurrentClosedTrades.length,
      nonComparableClosedTrades:
        currentClosedTrades.length - comparableCurrentClosedTrades.length,
    },
    realized: {
      pnl: sum(
        comparableCurrentClosedTrades.map((trade) =>
          finiteNumber(trade.closedPnl),
        ),
      ),
      fees: sum(
        comparableCurrentClosedTrades.map((trade) =>
          finiteNumber(trade.totalFee),
        ),
      ),
      funding: sum(
        comparableCurrentClosedTrades.map((trade) =>
          finiteNumber(trade.fundingFee),
        ),
      ),
    },
    gateComparison: {
      policy: llmComparatorPolicy,
      eligible: llmEligibleEvaluations.length,
      compared: gateComparisons.length,
      coverage: llmEligibleEvaluations.length
        ? round(gateComparisons.length / llmEligibleEvaluations.length)
        : null,
      agreements: gateComparisons.filter(
        (comparison) => comparison.gateDecision === comparison.llmDecision,
      ).length,
      disagreements: gateComparisons.filter(
        (comparison) => comparison.gateDecision !== comparison.llmDecision,
      ).length,
      gateApprovedLlmRejected: gateComparisons.filter(
        (comparison) =>
          comparison.gateDecision === 'approved' &&
          comparison.llmDecision === 'rejected',
      ).length,
      gateRejectedLlmApproved: gateComparisons.filter(
        (comparison) =>
          comparison.gateDecision === 'rejected' &&
          comparison.llmDecision === 'approved',
      ).length,
    },
    parity: {
      available: comparisonTotal > 0,
      matched,
      backtestOnly,
      runtimeOnly,
      ratio: parityRatio == null ? null : round(parityRatio),
      lineageReason,
    },
    execution: {
      available: actualSlippageBps != null || residualVsModelBps != null,
      actualSignalToFillSlippageBps: actualSlippageBps,
      residualVsCurrentModelBps: residualVsModelBps,
    },
    prospective,
    rolling,
    distributions: currentDistributions,
    distributionChanges: {
      available: previousDistributions != null,
      baselineWindow: previousArtifact
        ? {
            startTime: finiteNumber(previousArtifact.window.startTime),
            endTime: finiteNumber(previousArtifact.window.endTime),
          }
        : null,
      metrics: previousDistributions
        ? Object.fromEntries(
            Object.entries(currentDistributions).map(([name, current]) => [
              name,
              buildDistributionDelta(
                current,
                previousDistributions[
                  name as keyof typeof previousDistributions
                ],
              ),
            ]),
          )
        : {},
    },
    reactions,
  };
};

export const formatRuntimeScorecardMarkdown = (scorecard: RuntimeScorecard) => {
  const rollingRows = scorecard.rolling
    .map(
      (row) =>
        `| ${row.days}d | ${row.closedTrades} | ${row.realizedPnl} | ${row.expectancy ?? 'n/a'} | ${row.maxDrawdown} |`,
    )
    .join('\n');
  const reactions = scorecard.reactions.length
    ? scorecard.reactions
        .map(
          (reaction) =>
            `- ${reaction.severity.toUpperCase()} \`${reaction.code}\`: ${reaction.message}`,
        )
        .join('\n')
    : '- No automatic reactions.';
  const distributionChanges = Object.entries(
    scorecard.distributionChanges.metrics,
  )
    .flatMap(([metric, values]) =>
      Object.entries(values).map(([value, change]) => ({
        metric,
        value,
        shareDelta: change.shareDelta,
      })),
    )
    .sort(
      (left, right) => Math.abs(right.shareDelta) - Math.abs(left.shareDelta),
    )
    .slice(0, 10)
    .map(
      (change) =>
        `- ${change.metric}.${change.value}: ${change.shareDelta >= 0 ? '+' : ''}${round(change.shareDelta * 100, 2)} pp`,
    )
    .join('\n');

  return `# Runtime scorecard\n\nStatus: **${scorecard.promotionStatus}**\n\nWindow: ${new Date(scorecard.window.startTime).toISOString()} — ${new Date(scorecard.window.endTime).toISOString()}\n\n## Funnel\n\n- Evaluations: ${scorecard.funnel.evaluations}\n- Core candidates: ${scorecard.funnel.coreCandidates}\n- Gate approvals/rejects: ${scorecard.funnel.gate.approved}/${scorecard.funnel.gate.rejected}\n- AI / LLM disagreement: ${scorecard.gateComparison.disagreements}/${scorecard.gateComparison.compared}\n- Allocator approvals/rejects: ${scorecard.funnel.allocator.available ? `${scorecard.funnel.allocator.approved}/${scorecard.funnel.allocator.rejected}` : 'unavailable'}\n- Risk approvals/rejects: ${scorecard.funnel.risk.available ? `${scorecard.funnel.risk.approved}/${scorecard.funnel.risk.rejected}` : 'unavailable'}\n- Order attempts/failures: ${scorecard.funnel.orderAttempts}/${scorecard.funnel.orderFailures}\n- Fills: ${scorecard.funnel.fills}\n- Closed trades: ${scorecard.funnel.closedTrades}\n\n## Replay and execution\n\n- Parity: ${scorecard.parity.ratio == null ? 'n/a' : `${round(scorecard.parity.ratio * 100, 2)}%`}\n- Runtime/replay mismatches: ${scorecard.parity.backtestOnly + scorecard.parity.runtimeOnly}\n- Actual signal-to-fill slippage: ${scorecard.execution.actualSignalToFillSlippageBps ?? 'n/a'} bps\n- Residual vs current model: ${scorecard.execution.residualVsCurrentModelBps ?? 'n/a'} bps\n\n## Rolling performance\n\n| Window | Closed | Realized PnL | Expectancy | Max drawdown |\n| --- | ---: | ---: | ---: | ---: |\n${rollingRows}\n\n## Distribution changes\n\n${scorecard.distributionChanges.available ? distributionChanges || '- No distribution changes.' : '- Previous comparable artifact is unavailable.'}\n\n## Reactions\n\n${reactions}\n`;
};
