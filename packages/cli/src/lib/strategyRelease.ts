import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  STRATEGY_LIVE_DIAGNOSIS_SCHEMA,
  STRATEGY_RELEASE_SCHEMA,
  type StrategyEvidenceMarker,
  type StrategyEvidenceMarkerEnvelope,
  type StrategyEvidenceMarkerPayload,
  type StrategyEvidenceRetentionEntry,
  type StrategyLiveDiagnosis,
  type StrategyLiveDiagnosisEnvelope,
  type StrategyReleaseEnvelope,
  type StrategyReleaseEvidenceReference,
  type StrategyReleaseManifest,
  type StrategyReleaseReason,
} from '@tradejs/types';
import {
  canonicalStrategyEvidenceJson,
  compactStrategyEvidenceTimestamp,
  createStrategyEvidenceMarkerEnvelope,
  safeStrategyEvidenceSegment,
  strategyEvidenceFileSha256,
  strategyEvidenceSha256,
  verifyStrategyEvidenceMarkerEnvelope as verifyMarkerEnvelope,
} from '@tradejs/infra/strategyReleaseEvidence';

const SHA256_RE = /^[a-f0-9]{64}$/;
const LINEAGE_FINGERPRINT_RE = /^[a-f0-9]{16}$/;
const DAY_MS = 86_400_000;

const safeSegment = safeStrategyEvidenceSegment;
const compactTimestamp = compactStrategyEvidenceTimestamp;

export const canonicalStrategyReleaseJson = (value: unknown) =>
  canonicalStrategyEvidenceJson(value);

export const strategyReleaseSha256 = (value: unknown) =>
  strategyEvidenceSha256(value);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid strategy release: ${message}`);
}

const assertFingerprint = (value: string, label: string) =>
  assert(SHA256_RE.test(value), `${label} must be a lowercase SHA-256`);

const assertLineageFingerprint = (value: string, label: string) =>
  assert(
    LINEAGE_FINGERPRINT_RE.test(value),
    `${label} must be a 16-character lowercase lineage fingerprint`,
  );

type StrategyReleaseInput = Omit<
  StrategyReleaseManifest,
  'schema' | 'releaseId' | 'composition' | 'verdict'
> & {
  composition: Omit<StrategyReleaseManifest['composition'], 'compositionId'>;
  summary: string;
};

const releaseReasons = (
  input: Pick<StrategyReleaseInput, 'gates' | 'evidence' | 'researchBudget'>,
) => {
  const reasons: StrategyReleaseReason[] = [];
  const requiredEvidenceKinds: StrategyReleaseEvidenceReference['kind'][] = [
    'core_research',
    'ai_gate',
    'runtime_parity',
    'execution_calibration',
  ];
  if (
    input.evidence.some((entry) => !entry.verified) ||
    requiredEvidenceKinds.some(
      (kind) => !input.evidence.some((entry) => entry.kind === kind),
    )
  ) {
    reasons.push('EVIDENCE_INCOMPLETE');
  }
  if (!input.gates.coreEdgeVerified) reasons.push('NO_VERIFIED_CORE_EDGE');
  if (!input.gates.aiGateAddsValue) reasons.push('AI_GATE_ADDS_NO_VALUE');
  if (!input.gates.currentMarketSuitable) {
    reasons.push('CURRENT_REGIME_UNSUITABLE');
  }
  if (!input.gates.runtimeParityVerified) {
    reasons.push('RUNTIME_PARITY_BLOCKED');
  }
  if (!input.gates.executionModelVerified) {
    reasons.push('EXECUTION_MODEL_UNSAFE');
  }
  if (
    input.researchBudget.hypothesisFamilies >= 3 &&
    !input.gates.coreEdgeVerified
  ) {
    reasons.push('RESEARCH_BUDGET_EXHAUSTED');
  }
  return [...new Set(reasons)];
};

const deriveReleaseGates = (
  evidence: StrategyReleaseEvidenceReference[],
): StrategyReleaseManifest['gates'] => {
  const asserted = (name: keyof StrategyReleaseManifest['gates']) => {
    const values = evidence
      .filter((entry) => entry.verified)
      .map((entry) => entry.releaseAssertions?.[name])
      .filter((value): value is boolean => typeof value === 'boolean');
    return values.length > 0 && values.every(Boolean);
  };
  return {
    coreEdgeVerified: asserted('coreEdgeVerified'),
    aiGateAddsValue: asserted('aiGateAddsValue'),
    currentMarketSuitable: asserted('currentMarketSuitable'),
    runtimeParityVerified: asserted('runtimeParityVerified'),
    executionModelVerified: asserted('executionModelVerified'),
  };
};

const verifyEvidenceComposition = (
  strategy: string,
  composition: StrategyReleaseInput['composition'],
  evidence: StrategyReleaseEvidenceReference[],
) => {
  const requireEqual = (
    actual: string | number | boolean | null | undefined,
    expected: string | number | boolean,
    label: string,
    artifactId: string,
  ) =>
    assert(
      actual === expected,
      `evidence ${artifactId} ${label} does not match the frozen composition`,
    );

  for (const reference of evidence) {
    const lineage = reference.lineage;
    if (reference.kind === 'core_research') {
      requireEqual(
        lineage?.strategy,
        strategy,
        'strategy',
        reference.artifactId,
      );
      requireEqual(
        lineage?.coreConfigSha256,
        composition.coreConfigSha256,
        'coreConfigSha256',
        reference.artifactId,
      );
      requireEqual(
        lineage?.gitSha,
        composition.gitSha,
        'gitSha',
        reference.artifactId,
      );
      requireEqual(lineage?.gitDirty, false, 'gitDirty', reference.artifactId);
      requireEqual(
        lineage?.maxLossValue,
        composition.maxLossValue,
        'MAX_LOSS_VALUE',
        reference.artifactId,
      );
      assert(
        lineage?.sourceSha256s.includes(composition.coreExportSha256),
        `evidence ${reference.artifactId} does not include the frozen core export`,
      );
      continue;
    }
    if (reference.kind === 'ai_gate') {
      requireEqual(
        lineage?.strategy,
        strategy,
        'strategy',
        reference.artifactId,
      );
      requireEqual(
        lineage?.gitSha,
        composition.gitSha,
        'gitSha',
        reference.artifactId,
      );
      requireEqual(lineage?.gitDirty, false, 'gitDirty', reference.artifactId);
      requireEqual(
        lineage?.gateConfigIdsFingerprint,
        composition.gateConfigIdsFingerprint,
        'gateConfigIdsFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.gateFingerprint,
        composition.gateFingerprint,
        'gateFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.gateContextFingerprint,
        composition.gateContextFingerprint,
        'gateContextFingerprint',
        reference.artifactId,
      );
      assert(
        lineage?.sourceSha256s.includes(composition.coreExportSha256),
        `evidence ${reference.artifactId} does not use the frozen core export`,
      );
      continue;
    }
    if (reference.kind === 'runtime_parity') {
      requireEqual(
        lineage?.strategy,
        strategy,
        'strategy',
        reference.artifactId,
      );
      requireEqual(
        lineage?.gitSha,
        composition.gitSha,
        'gitSha',
        reference.artifactId,
      );
      requireEqual(lineage?.gitDirty, false, 'gitDirty', reference.artifactId);
      requireEqual(
        lineage?.gateFingerprint,
        composition.gateFingerprint,
        'gateFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.runtimeConfigFingerprint,
        composition.runtimeConfigFingerprint,
        'runtimeConfigFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.runtimeContextFingerprint,
        composition.runtimeContextFingerprint,
        'runtimeContextFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.maxLossValue,
        composition.maxLossValue,
        'MAX_LOSS_VALUE',
        reference.artifactId,
      );
      continue;
    }
    if (reference.kind === 'execution_calibration') {
      requireEqual(
        lineage?.strategy,
        strategy,
        'strategy',
        reference.artifactId,
      );
      requireEqual(
        lineage?.gitSha,
        composition.gitSha,
        'gitSha',
        reference.artifactId,
      );
      requireEqual(lineage?.gitDirty, false, 'gitDirty', reference.artifactId);
      requireEqual(
        lineage?.gateFingerprint,
        composition.gateFingerprint,
        'gateFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.runtimeConfigFingerprint,
        composition.runtimeConfigFingerprint,
        'runtimeConfigFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.runtimeContextFingerprint,
        composition.runtimeContextFingerprint,
        'runtimeContextFingerprint',
        reference.artifactId,
      );
      requireEqual(
        lineage?.maxLossValue,
        composition.maxLossValue,
        'MAX_LOSS_VALUE',
        reference.artifactId,
      );
    }
  }
};

export const createStrategyReleaseManifest = (
  input: StrategyReleaseInput,
): StrategyReleaseManifest => {
  assert(input.strategy.trim(), 'strategy is required');
  assert(
    Number.isFinite(input.createdAt),
    'createdAt must be a finite timestamp',
  );
  assert(
    input.researchBudget.hypothesisFamilies <= 3,
    'at most 3 hypothesis families are allowed',
  );
  assert(
    input.researchBudget.maximumVariantsPerFamily <= 5,
    'at most 5 variants per family are allowed',
  );
  assert(
    input.researchBudget.isolatedLongFinalists <= 1,
    'at most one isolated-long finalist is allowed',
  );
  assert(
    input.researchBudget.aiGateTuningRounds <= 1,
    'at most one AI-gate tuning round is allowed',
  );
  assert(input.marketWindow.cacheOnly, 'market window must be cache-only');
  assert(
    input.marketWindow.endTime > input.marketWindow.startTime,
    'market window is invalid',
  );
  assert(input.composition.maxLossValue > 0, 'MAX_LOSS_VALUE must be positive');
  assert(
    input.composition.longEnabled && input.composition.shortEnabled,
    'LONG and SHORT must both remain enabled',
  );
  assert(
    Number.isInteger(input.monitoring.minimumProspectiveClosedTrades) &&
      input.monitoring.minimumProspectiveClosedTrades > 0,
    'monitoring.minimumProspectiveClosedTrades must be positive',
  );
  assert(
    Number.isFinite(input.monitoring.minimumParityRatio) &&
      input.monitoring.minimumParityRatio >= 0 &&
      input.monitoring.minimumParityRatio <= 1,
    'monitoring.minimumParityRatio must be between 0 and 1',
  );
  assert(
    Number.isFinite(input.monitoring.maximumOrderFailureRate) &&
      input.monitoring.maximumOrderFailureRate >= 0 &&
      input.monitoring.maximumOrderFailureRate <= 1,
    'monitoring.maximumOrderFailureRate must be between 0 and 1',
  );
  assert(
    Number.isFinite(input.monitoring.minimumRegimeCoverage) &&
      input.monitoring.minimumRegimeCoverage >= 0 &&
      input.monitoring.minimumRegimeCoverage <= 1,
    'monitoring.minimumRegimeCoverage must be between 0 and 1',
  );
  assert(
    input.monitoring.drawdownEnvelopes.length > 0 &&
      input.monitoring.drawdownEnvelopes.every(
        (entry) =>
          Number.isInteger(entry.days) &&
          entry.days > 0 &&
          Number.isFinite(entry.p95) &&
          Number.isFinite(entry.maximum) &&
          entry.p95 >= 0 &&
          entry.maximum >= entry.p95,
      ),
    'monitoring drawdown envelopes are invalid',
  );
  assertFingerprint(input.composition.coreConfigSha256, 'coreConfigSha256');
  assertFingerprint(input.composition.coreExportSha256, 'coreExportSha256');
  assertLineageFingerprint(
    input.composition.gateConfigIdsFingerprint,
    'gateConfigIdsFingerprint',
  );
  assertLineageFingerprint(
    input.composition.runtimeConfigFingerprint,
    'runtimeConfigFingerprint',
  );
  assertLineageFingerprint(
    input.composition.gateFingerprint,
    'gateFingerprint',
  );
  assertLineageFingerprint(
    input.composition.gateContextFingerprint,
    'gateContextFingerprint',
  );
  assertLineageFingerprint(
    input.composition.runtimeContextFingerprint,
    'runtimeContextFingerprint',
  );
  assertFingerprint(input.marketWindow.universeSha256, 'universeSha256');
  for (const entry of input.evidence) {
    assertFingerprint(entry.sha256, `evidence ${entry.artifactId}`);
  }
  verifyEvidenceComposition(input.strategy, input.composition, input.evidence);
  const evidenceGates = deriveReleaseGates(input.evidence);
  assert(
    canonicalStrategyReleaseJson(input.gates) ===
      canonicalStrategyReleaseJson(evidenceGates),
    'release gates must be derived from verified evidence assertions',
  );

  const compositionIdentity = {
    strategy: input.strategy,
    gitSha: input.composition.gitSha,
    coreConfigSha256: input.composition.coreConfigSha256,
    coreExportSha256: input.composition.coreExportSha256,
    gateConfigIdsFingerprint: input.composition.gateConfigIdsFingerprint,
    runtimeConfigFingerprint: input.composition.runtimeConfigFingerprint,
    gateFingerprint: input.composition.gateFingerprint,
    gateContextFingerprint: input.composition.gateContextFingerprint,
    runtimeContextFingerprint: input.composition.runtimeContextFingerprint,
    maxLossValue: input.composition.maxLossValue,
  };
  const compositionId = `${safeSegment(input.strategy, 'strategy')}_${strategyReleaseSha256(compositionIdentity).slice(0, 16)}`;
  const reasons = releaseReasons({ ...input, gates: evidenceGates });
  const economicFailure = reasons.some((reason) =>
    [
      'NO_VERIFIED_CORE_EDGE',
      'AI_GATE_ADDS_NO_VALUE',
      'CURRENT_REGIME_UNSUITABLE',
      'RESEARCH_BUDGET_EXHAUSTED',
    ].includes(reason),
  );
  const evidenceFailure = reasons.some((reason) =>
    [
      'EVIDENCE_INCOMPLETE',
      'RUNTIME_PARITY_BLOCKED',
      'EXECUTION_MODEL_UNSAFE',
    ].includes(reason),
  );
  const verdict = evidenceFailure
    ? 'INSUFFICIENT_EVIDENCE'
    : economicFailure
      ? 'UNSUITABLE_FOR_CURRENT_MARKET'
      : 'READY_FOR_RUNTIME';
  const releaseIdentity = {
    strategy: input.strategy,
    createdAt: input.createdAt,
    compositionId,
    evidence: input.evidence.map(({ kind, artifactId, sha256 }) => ({
      kind,
      artifactId,
      sha256,
    })),
    verdict,
  };

  return {
    schema: STRATEGY_RELEASE_SCHEMA,
    releaseId: `${safeSegment(input.strategy, 'strategy')}_${compactTimestamp(input.createdAt)}_${strategyReleaseSha256(releaseIdentity).slice(0, 16)}`,
    strategy: input.strategy,
    createdAt: input.createdAt,
    composition: { ...input.composition, compositionId },
    marketWindow: input.marketWindow,
    researchBudget: input.researchBudget,
    evidence: input.evidence,
    gates: evidenceGates,
    monitoring: input.monitoring,
    verdict: {
      status: verdict,
      reasons,
      summary: input.summary,
    },
    prospective: input.prospective,
  };
};

export const createStrategyReleaseEnvelope = (
  manifest: StrategyReleaseManifest,
): StrategyReleaseEnvelope => ({
  schema: 'tradejs-strategy-release-envelope/v1',
  releaseId: manifest.releaseId,
  manifestSha256: strategyReleaseSha256(manifest),
  manifest,
});

export const verifyStrategyReleaseEnvelope = async (
  valueOrPath: StrategyReleaseEnvelope | string,
) => {
  const value =
    typeof valueOrPath === 'string'
      ? (JSON.parse(await fs.readFile(valueOrPath, 'utf8')) as unknown)
      : valueOrPath;
  const envelope = value as StrategyReleaseEnvelope;
  assert(
    envelope?.schema === 'tradejs-strategy-release-envelope/v1',
    'release envelope schema mismatch',
  );
  assert(
    envelope.releaseId === envelope.manifest?.releaseId,
    'releaseId mismatch',
  );
  assert(
    strategyReleaseSha256(envelope.manifest) === envelope.manifestSha256,
    'release manifest checksum mismatch',
  );
  const manifest = envelope.manifest;
  assert(
    manifest.schema === STRATEGY_RELEASE_SCHEMA,
    'manifest schema mismatch',
  );
  const rebuilt = createStrategyReleaseManifest({
    strategy: manifest.strategy,
    createdAt: manifest.createdAt,
    composition: {
      gitSha: manifest.composition.gitSha,
      coreConfigSha256: manifest.composition.coreConfigSha256,
      coreExportSha256: manifest.composition.coreExportSha256,
      gateConfigIdsFingerprint: manifest.composition.gateConfigIdsFingerprint,
      runtimeConfigFingerprint: manifest.composition.runtimeConfigFingerprint,
      gateFingerprint: manifest.composition.gateFingerprint,
      gateContextFingerprint: manifest.composition.gateContextFingerprint,
      runtimeContextFingerprint: manifest.composition.runtimeContextFingerprint,
      maxLossValue: manifest.composition.maxLossValue,
      longEnabled: manifest.composition.longEnabled,
      shortEnabled: manifest.composition.shortEnabled,
    },
    marketWindow: manifest.marketWindow,
    researchBudget: manifest.researchBudget,
    evidence: manifest.evidence,
    gates: manifest.gates,
    monitoring: manifest.monitoring,
    summary: manifest.verdict.summary,
    prospective: manifest.prospective,
  });
  assert(
    canonicalStrategyReleaseJson(rebuilt) ===
      canonicalStrategyReleaseJson(manifest),
    'release manifest contains self-declared or inconsistent derived fields',
  );
  return envelope;
};

export { createStrategyEvidenceMarkerEnvelope };

export const verifyStrategyEvidenceMarkerEnvelope = async (
  valueOrPath: StrategyEvidenceMarkerEnvelope | string,
) => {
  const value =
    typeof valueOrPath === 'string'
      ? (JSON.parse(await fs.readFile(valueOrPath, 'utf8')) as unknown)
      : valueOrPath;
  return verifyMarkerEnvelope(value);
};

const releaseMarkers = (manifest: StrategyReleaseManifest) => {
  const common = {
    timestamp: manifest.createdAt,
    artifactId: manifest.releaseId,
    artifactSha256: strategyReleaseSha256(manifest),
    compositionId: manifest.composition.compositionId,
    gitSha: manifest.composition.gitSha,
    gateFingerprint: manifest.composition.gateFingerprint,
    configFingerprint: manifest.composition.runtimeConfigFingerprint,
    contextFingerprint: manifest.composition.runtimeContextFingerprint,
    maxLossValue: manifest.composition.maxLossValue,
  };
  return [
    {
      ...common,
      id: `${manifest.releaseId}:evidence`,
      type: 'E',
      label: 'Evidence frozen',
      summary: `${manifest.evidence.length} verified release artifacts`,
      coverage: {
        startTime: manifest.marketWindow.startTime,
        endTime: manifest.marketWindow.endTime,
      },
    },
    {
      ...common,
      id: `${manifest.releaseId}:gate`,
      type: 'G',
      label: 'Composition frozen',
      summary: manifest.composition.compositionId,
    },
    {
      ...common,
      id: `${manifest.releaseId}:loss`,
      type: 'L',
      label: 'Trade loss value',
      summary: `MAX_LOSS_VALUE ${manifest.composition.maxLossValue}`,
      maxLossValue: manifest.composition.maxLossValue,
    },
    {
      ...common,
      id: `${manifest.releaseId}:deployment`,
      type: 'D',
      label: 'Release manifest',
      summary: manifest.verdict.status,
      severity:
        manifest.verdict.status === 'READY_FOR_RUNTIME' ? 'info' : 'blocking',
    },
    {
      ...common,
      id: `${manifest.releaseId}:recommendation`,
      type: 'R',
      label: 'Release recommendation',
      summary: manifest.verdict.summary,
      severity:
        manifest.verdict.status === 'READY_FOR_RUNTIME' ? 'info' : 'warning',
    },
  ] satisfies StrategyEvidenceMarker[];
};

const writeJsonAtomic = async (filePath: string, value: unknown) => {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    temporaryPath,
    `${canonicalStrategyReleaseJson(value)}\n`,
    'utf8',
  );
  await fs.rename(temporaryPath, filePath);
};

export const publishStrategyRelease = async ({
  rootDir,
  manifest,
}: {
  rootDir: string;
  manifest: StrategyReleaseManifest;
}) => {
  const envelope = createStrategyReleaseEnvelope(manifest);
  const markerEnvelope = createStrategyEvidenceMarkerEnvelope({
    strategy: manifest.strategy,
    createdAt: manifest.createdAt,
    markers: releaseMarkers(manifest),
    sourceArtifacts: manifest.evidence.map((entry) => ({
      artifactId: entry.artifactId,
      sha256: entry.sha256,
      path: entry.path,
    })),
  });
  const releasePath = path.join(
    rootDir,
    'releases',
    safeSegment(manifest.strategy, 'strategy'),
    `${manifest.releaseId}.json`,
  );
  const markerPath = path.join(
    rootDir,
    'markers',
    safeSegment(manifest.strategy, 'strategy'),
    `${markerEnvelope.artifactId}.json`,
  );
  await Promise.all([
    writeJsonAtomic(releasePath, envelope),
    writeJsonAtomic(markerPath, markerEnvelope),
  ]);
  await Promise.all([
    verifyStrategyReleaseEnvelope(releasePath),
    verifyStrategyEvidenceMarkerEnvelope(markerPath),
  ]);
  return { releasePath, markerPath, envelope, markerEnvelope };
};

type StrategyLiveDiagnosisInput = Omit<
  StrategyLiveDiagnosis,
  | 'schema'
  | 'verdict'
  | 'subtype'
  | 'confidence'
  | 'evidence'
  | 'explanation'
  | 'recommendations'
> &
  Omit<
    StrategyLiveDiagnosis['evidence'],
    | 'riskScaleComparable'
    | 'releaseMaxLossValue'
    | 'runtimeMaxLossValue'
    | 'riskScaleRatio'
    | 'normalizedObservedDrawdown'
  > & {
    riskScaleComparable?: boolean;
    releaseMaxLossValue?: number | null;
    runtimeMaxLossValue?: number | null;
    riskScaleRatio?: number | null;
    normalizedObservedDrawdown?: number | null;
    minimumClosedTrades?: number;
    minimumParityRatio?: number;
    maximumOrderFailureRate?: number;
    minimumRegimeCoverage?: number;
  };

export const buildStrategyLiveDiagnosis = (
  input: StrategyLiveDiagnosisInput,
): StrategyLiveDiagnosis => {
  const minimumClosedTrades = input.minimumClosedTrades ?? 20;
  const minimumParityRatio = input.minimumParityRatio ?? 0.95;
  const maximumOrderFailureRate = input.maximumOrderFailureRate ?? 0.05;
  const minimumRegimeCoverage = input.minimumRegimeCoverage ?? 0.5;
  const hasExplicitRiskScale = input.riskScaleComparable != null;
  const comparisonObservedDrawdown = hasExplicitRiskScale
    ? input.riskScaleComparable
      ? input.normalizedObservedDrawdown ?? null
      : null
    : input.observedDrawdown;
  const runtimeDivergence =
    !input.lineageComparable ||
    (input.parityRatio != null && input.parityRatio < minimumParityRatio) ||
    (input.orderFailureRate != null &&
      input.orderFailureRate > maximumOrderFailureRate);
  const insufficient =
    input.closedTrades < minimumClosedTrades ||
    input.parityRatio == null ||
    comparisonObservedDrawdown == null ||
    input.historicalDrawdownP95 == null;
  const expected =
    !runtimeDivergence &&
    !insufficient &&
    comparisonObservedDrawdown! <= input.historicalDrawdownP95!;
  const verdict = runtimeDivergence
    ? 'RUNTIME_DIVERGENCE'
    : insufficient
      ? 'INSUFFICIENT_EVIDENCE'
      : expected
        ? 'EXPECTED_DRAWDOWN'
        : 'GENERALIZATION_FAILURE';
  const attributionIncomplete =
    input.rawCoreExpectancyDelta == null ||
    input.aiGateAddedValue == null ||
    input.regimeCoverage == null;
  const attributedVerdict =
    verdict === 'GENERALIZATION_FAILURE' && attributionIncomplete
      ? 'INSUFFICIENT_EVIDENCE'
      : verdict;
  const subtype =
    attributedVerdict !== 'GENERALIZATION_FAILURE'
      ? null
      : input.rawCoreExpectancyDelta! < 0 && input.aiGateAddedValue! >= 0
        ? 'RAW_CORE_DECAY'
        : input.aiGateAddedValue! < 0
          ? 'AI_GATE_FAILURE'
          : input.regimeCoverage! < minimumRegimeCoverage
            ? 'REGIME_SHIFT'
            : (input.overfitProbability ?? 0) >= 0.5
              ? 'SUSPECTED_HISTORICAL_OVERFIT'
              : 'RAW_CORE_DECAY';
  const explanation =
    attributedVerdict === 'RUNTIME_DIVERGENCE'
      ? 'Runtime cannot be compared economically until lineage, replay parity, and order execution agree with the frozen composition.'
      : attributedVerdict === 'EXPECTED_DRAWDOWN'
        ? 'The observed drawdown is within the preregistered equal-length historical drawdown envelope.'
        : attributedVerdict === 'GENERALIZATION_FAILURE'
          ? `Runtime is comparable, but the observed drawdown exceeds the historical envelope (${subtype}).`
          : attributionIncomplete && verdict === 'GENERALIZATION_FAILURE'
            ? 'The drawdown breaches its historical envelope, but matched shadow raw-core, deterministic-gate, or causal regime evidence is missing for attribution.'
            : 'There are not enough comparable closed trades and historical drawdown observations for attribution.';
  const recommendations =
    attributedVerdict === 'RUNTIME_DIVERGENCE'
      ? [
          'Resolve lineage and replay parity mismatches before evaluating strategy economics.',
          'Inspect order failures and execution residuals against the frozen execution model.',
        ]
      : attributedVerdict === 'EXPECTED_DRAWDOWN'
        ? [
            'Keep the frozen composition unchanged and continue prospective evidence collection.',
          ]
        : attributedVerdict === 'GENERALIZATION_FAILURE'
          ? [
              'Do not retune the live cohort; open a new immutable research lineage.',
              'Compare raw-core decay, AI-gate added value, and causal regime coverage.',
            ]
          : [
              attributionIncomplete && verdict === 'GENERALIZATION_FAILURE'
                ? 'Collect matched shadow raw-core, deterministic-gate, and causal regime evidence without changing the composition.'
                : 'Collect more verified prospective outcomes without changing the composition.',
            ];

  return {
    schema: STRATEGY_LIVE_DIAGNOSIS_SCHEMA,
    strategy: input.strategy,
    compositionId: input.compositionId,
    createdAt: input.createdAt,
    verdict: attributedVerdict,
    subtype,
    confidence:
      runtimeDivergence || input.closedTrades >= 50
        ? 'high'
        : input.closedTrades >= 20
          ? 'medium'
          : 'low',
    evidence: {
      lineageComparable: input.lineageComparable,
      riskScaleComparable: input.riskScaleComparable ?? false,
      releaseMaxLossValue: input.releaseMaxLossValue ?? null,
      runtimeMaxLossValue: input.runtimeMaxLossValue ?? null,
      riskScaleRatio: input.riskScaleRatio ?? null,
      parityRatio: input.parityRatio,
      orderFailureRate: input.orderFailureRate,
      observedDrawdown: input.observedDrawdown,
      normalizedObservedDrawdown: input.normalizedObservedDrawdown ?? null,
      historicalDrawdownP95: input.historicalDrawdownP95,
      historicalDrawdownMaximum: input.historicalDrawdownMaximum,
      closedTrades: input.closedTrades,
      rawCoreExpectancyDelta: input.rawCoreExpectancyDelta,
      aiGateAddedValue: input.aiGateAddedValue,
      regimeCoverage: input.regimeCoverage,
      overfitProbability: input.overfitProbability,
    },
    explanation,
    recommendations,
  };
};

export const buildStrategyLiveDiagnosisFromScorecard = ({
  manifest,
  scorecard,
  days,
}: {
  manifest: StrategyReleaseManifest;
  scorecard: {
    generatedAt: number;
    parity: { ratio: number | null; lineageReason: string | null };
    lineage?: {
      complete: boolean;
      conflicts: boolean;
      compositionId: string | null;
      gitSha: string | null;
      gitDirty: boolean | null;
      gateFingerprint: string | null;
      configFingerprint: string | null;
      contextFingerprint: string | null;
      maxLossValue: number | null;
    };
    funnel: { orderAttempts: number; orderFailures: number };
    rolling: Array<{
      days: number;
      closedTrades: number;
      maxDrawdown: number;
      expectancy: number | null;
    }>;
    prospective?: {
      rawCoreExpectancy: number | null;
      aiGateExpectancy: number | null;
      regimeCoverage: number | null;
    } | null;
  };
  days: number;
}) => {
  const rolling = scorecard.rolling.find((entry) => entry.days === days);
  const envelope = manifest.monitoring.drawdownEnvelopes.find(
    (entry) => entry.days === days,
  );
  const orderFailureRate = scorecard.funnel.orderAttempts
    ? scorecard.funnel.orderFailures / scorecard.funnel.orderAttempts
    : null;
  const lineage = scorecard.lineage;
  const lineageComparable =
    scorecard.parity.lineageReason == null &&
    lineage?.complete === true &&
    lineage.conflicts === false &&
    lineage.compositionId === manifest.composition.compositionId &&
    lineage.gitDirty === false &&
    lineage.gitSha === manifest.composition.gitSha &&
    lineage.configFingerprint ===
      manifest.composition.runtimeConfigFingerprint &&
    lineage.gateFingerprint === manifest.composition.gateFingerprint &&
    lineage.contextFingerprint ===
      manifest.composition.runtimeContextFingerprint;
  const releaseMaxLossValue = manifest.composition.maxLossValue;
  const runtimeMaxLossValue = lineage?.maxLossValue ?? null;
  const riskScaleComparable =
    Number.isFinite(releaseMaxLossValue) &&
    releaseMaxLossValue > 0 &&
    runtimeMaxLossValue != null &&
    Number.isFinite(runtimeMaxLossValue) &&
    runtimeMaxLossValue > 0;
  const riskScaleRatio = riskScaleComparable
    ? runtimeMaxLossValue / releaseMaxLossValue
    : null;
  const normalizedObservedDrawdown =
    rolling != null && riskScaleRatio != null
      ? rolling.maxDrawdown / riskScaleRatio
      : null;
  const normalizeRuntimeEconomics = (value: number | null | undefined) =>
    value != null && riskScaleRatio != null ? value / riskScaleRatio : null;
  return buildStrategyLiveDiagnosis({
    strategy: manifest.strategy,
    compositionId: manifest.composition.compositionId,
    createdAt: scorecard.generatedAt,
    lineageComparable,
    riskScaleComparable,
    releaseMaxLossValue,
    runtimeMaxLossValue,
    riskScaleRatio,
    parityRatio: scorecard.parity.ratio,
    orderFailureRate,
    observedDrawdown: rolling?.maxDrawdown ?? null,
    normalizedObservedDrawdown,
    historicalDrawdownP95: envelope?.p95 ?? null,
    historicalDrawdownMaximum: envelope?.maximum ?? null,
    closedTrades: rolling?.closedTrades ?? 0,
    rawCoreExpectancyDelta:
      scorecard.prospective?.rawCoreExpectancy != null &&
      manifest.monitoring.rawCoreExpectancy != null
        ? normalizeRuntimeEconomics(scorecard.prospective.rawCoreExpectancy)! -
          manifest.monitoring.rawCoreExpectancy
        : null,
    aiGateAddedValue:
      scorecard.prospective?.rawCoreExpectancy != null &&
      scorecard.prospective.aiGateExpectancy != null
        ? normalizeRuntimeEconomics(scorecard.prospective.aiGateExpectancy)! -
          normalizeRuntimeEconomics(scorecard.prospective.rawCoreExpectancy)!
        : null,
    regimeCoverage: scorecard.prospective?.regimeCoverage ?? null,
    overfitProbability: manifest.monitoring.overfitProbability,
    minimumClosedTrades: manifest.monitoring.minimumProspectiveClosedTrades,
    minimumParityRatio: manifest.monitoring.minimumParityRatio,
    maximumOrderFailureRate: manifest.monitoring.maximumOrderFailureRate,
    minimumRegimeCoverage: manifest.monitoring.minimumRegimeCoverage,
  });
};

type MonitoringTrade = {
  exitTimestamp: number;
  netProfit: number;
};

const realizedDrawdown = (
  trades: MonitoringTrade[],
  startIndex = 0,
  endIndex = trades.length,
) => {
  let equity = 0;
  let peak = 0;
  let maximum = 0;
  for (let index = startIndex; index < endIndex; index += 1) {
    const trade = trades[index];
    equity += trade.netProfit;
    peak = Math.max(peak, equity);
    maximum = Math.max(maximum, peak - equity);
  }
  return maximum;
};

const lowerBoundExitTimestamp = (
  trades: MonitoringTrade[],
  timestamp: number,
) => {
  let left = 0;
  let right = trades.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (trades[middle].exitTimestamp < timestamp) left = middle + 1;
    else right = middle;
  }
  return left;
};

const percentile = (values: number[], probability: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return (
    sorted[lower] * (upper - position) + sorted[upper] * (position - lower)
  );
};

export const buildStrategyMonitoringProfile = ({
  trades,
  startTime,
  endTime,
  days,
  minimumProspectiveClosedTrades = 20,
  minimumParityRatio = 0.95,
  maximumOrderFailureRate = 0.05,
  minimumRegimeCoverage = 0.5,
  aiGateExpectancy = null,
  overfitProbability = null,
}: {
  trades: MonitoringTrade[];
  startTime: number;
  endTime: number;
  days: number[];
  minimumProspectiveClosedTrades?: number;
  minimumParityRatio?: number;
  maximumOrderFailureRate?: number;
  minimumRegimeCoverage?: number;
  aiGateExpectancy?: number | null;
  overfitProbability?: number | null;
}): StrategyReleaseManifest['monitoring'] => {
  assert(endTime > startTime, 'monitoring profile window is invalid');
  assert(days.length > 0, 'monitoring profile days are required');
  const ordered = trades
    .filter(
      (trade) =>
        Number.isFinite(trade.exitTimestamp) &&
        Number.isFinite(trade.netProfit) &&
        trade.exitTimestamp >= startTime &&
        trade.exitTimestamp < endTime,
    )
    .sort((left, right) => left.exitTimestamp - right.exitTimestamp);
  const drawdownEnvelopes = [...new Set(days)]
    .sort((left, right) => left - right)
    .map((windowDays) => {
      assert(
        Number.isInteger(windowDays) && windowDays > 0,
        'monitoring profile days must be positive integers',
      );
      const duration = windowDays * DAY_MS;
      assert(
        endTime - startTime >= duration,
        `${windowDays}d monitoring window exceeds historical coverage`,
      );
      const drawdowns: number[] = [];
      for (
        let windowStart = startTime;
        windowStart + duration <= endTime;
        windowStart += DAY_MS
      ) {
        const windowEnd = windowStart + duration;
        drawdowns.push(
          realizedDrawdown(
            ordered,
            lowerBoundExitTimestamp(ordered, windowStart),
            lowerBoundExitTimestamp(ordered, windowEnd),
          ),
        );
      }
      return {
        days: windowDays,
        p95: percentile(drawdowns, 0.95),
        maximum: Math.max(...drawdowns),
      };
    });
  return {
    minimumProspectiveClosedTrades,
    minimumParityRatio,
    maximumOrderFailureRate,
    minimumRegimeCoverage,
    drawdownEnvelopes,
    rawCoreExpectancy: ordered.length
      ? ordered.reduce((sum, trade) => sum + trade.netProfit, 0) /
        ordered.length
      : null,
    aiGateExpectancy,
    overfitProbability,
  };
};

export const publishStrategyLiveDiagnosis = async ({
  rootDir,
  diagnosis,
  sourceArtifacts,
  composition,
}: {
  rootDir: string;
  diagnosis: StrategyLiveDiagnosis;
  sourceArtifacts: StrategyEvidenceMarkerPayload['sourceArtifacts'];
  composition?: StrategyReleaseManifest['composition'];
}) => {
  const diagnosisSha256 = strategyReleaseSha256(diagnosis);
  const diagnosisId = `${safeSegment(diagnosis.strategy, 'strategy')}_${compactTimestamp(diagnosis.createdAt)}_${diagnosisSha256.slice(0, 16)}`;
  const envelope: StrategyLiveDiagnosisEnvelope = {
    schema: 'tradejs-strategy-live-diagnosis-envelope/v1',
    diagnosisId,
    diagnosisSha256,
    diagnosis,
  };
  const common = {
    timestamp: diagnosis.createdAt,
    artifactId: diagnosisId,
    artifactSha256: diagnosisSha256,
    compositionId: diagnosis.compositionId,
    ...(composition
      ? {
          gitSha: composition.gitSha,
          configFingerprint: composition.runtimeConfigFingerprint,
          gateFingerprint: composition.gateFingerprint,
          contextFingerprint: composition.runtimeContextFingerprint,
          maxLossValue: composition.maxLossValue,
        }
      : {}),
  };
  const markers: StrategyEvidenceMarker[] = [
    ...(diagnosis.evidence.runtimeMaxLossValue != null &&
    diagnosis.evidence.runtimeMaxLossValue !==
      diagnosis.evidence.releaseMaxLossValue
      ? [
          {
            ...common,
            id: `${diagnosisId}:loss`,
            type: 'L' as const,
            label: 'Trade loss value changed',
            summary: `MAX_LOSS_VALUE ${diagnosis.evidence.runtimeMaxLossValue}`,
            maxLossValue: diagnosis.evidence.runtimeMaxLossValue,
            severity: 'info' as const,
          },
        ]
      : []),
    ...(diagnosis.verdict === 'RUNTIME_DIVERGENCE'
      ? [
          {
            ...common,
            id: `${diagnosisId}:parity`,
            type: 'P' as const,
            label: 'Runtime parity mismatch',
            summary: diagnosis.explanation,
            severity: 'blocking' as const,
          },
        ]
      : []),
    {
      ...common,
      id: `${diagnosisId}:recommendation`,
      type: 'R',
      label: 'Live diagnosis',
      summary: `${diagnosis.verdict}: ${diagnosis.explanation}`,
      severity: diagnosis.verdict === 'EXPECTED_DRAWDOWN' ? 'info' : 'warning',
    },
  ];
  const markerEnvelope = createStrategyEvidenceMarkerEnvelope({
    strategy: diagnosis.strategy,
    createdAt: diagnosis.createdAt,
    markers,
    sourceArtifacts,
  });
  const diagnosisPath = path.join(
    rootDir,
    'diagnoses',
    safeSegment(diagnosis.strategy, 'strategy'),
    `${diagnosisId}.json`,
  );
  const markerPath = path.join(
    rootDir,
    'markers',
    safeSegment(diagnosis.strategy, 'strategy'),
    `${markerEnvelope.artifactId}.json`,
  );
  await Promise.all([
    writeJsonAtomic(diagnosisPath, envelope),
    writeJsonAtomic(markerPath, markerEnvelope),
  ]);
  await verifyStrategyEvidenceMarkerEnvelope(markerPath);
  return { diagnosisPath, markerPath, envelope, markerEnvelope };
};

export const planStrategyEvidenceRetention = ({
  now,
  entries,
  retentionDays = {
    operational_redis: 3,
    verbose_payload: 14,
    verified_runtime_bundle: 90,
    compact_ledger: null,
  },
}: {
  now: number;
  entries: StrategyEvidenceRetentionEntry[];
  retentionDays?: Record<StrategyEvidenceRetentionEntry['kind'], number | null>;
}) => {
  const keep: StrategyEvidenceRetentionEntry[] = [];
  const remove: StrategyEvidenceRetentionEntry[] = [];
  for (const entry of entries) {
    const days = retentionDays[entry.kind];
    if (
      days == null ||
      !entry.verified ||
      !entry.aggregated ||
      now - entry.createdAt <= days * DAY_MS
    ) {
      keep.push(entry);
    } else {
      remove.push(entry);
    }
  }
  return {
    keep,
    delete: remove,
    bytesReclaimable: remove.reduce((total, entry) => total + entry.bytes, 0),
  };
};

type StrategyReleaseEvidenceLineage = NonNullable<
  StrategyReleaseEvidenceReference['lineage']
>;

const finiteString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const uniqueStrings = (values: unknown[]) => [
  ...new Set(
    values.map(finiteString).filter((value): value is string => value != null),
  ),
];

const incompleteEvidenceLineage = (): StrategyReleaseEvidenceLineage => ({
  strategy: null,
  gitSha: null,
  gitDirty: null,
  coreConfigSha256: null,
  gateConfigIdsFingerprint: null,
  gateFingerprint: null,
  runtimeConfigFingerprint: null,
  gateContextFingerprint: null,
  runtimeContextFingerprint: null,
  maxLossValue: null,
  sourceSha256s: [],
});

const extractEvidenceLineage = ({
  artifact,
  reference,
  nested,
  array,
}: {
  artifact: Record<string, unknown>;
  reference: StrategyReleaseEvidenceReference;
  nested: (value: unknown) => Record<string, unknown> | null;
  array: (value: unknown) => unknown[];
}): StrategyReleaseEvidenceLineage => {
  const empty = incompleteEvidenceLineage();
  if (reference.kind === 'core_research') {
    const variants = array(artifact.variants)
      .map(nested)
      .filter((entry): entry is Record<string, unknown> => entry != null);
    const selectedCandidateIds = uniqueStrings(
      array(artifact.comparisons)
        .map(nested)
        .filter(
          (comparison): comparison is Record<string, unknown> =>
            comparison != null && nested(comparison.selection)?.passed === true,
        )
        .map((comparison) => comparison.candidateId),
    );
    const selectedVariants =
      selectedCandidateIds.length === 1
        ? variants.filter(
            (variant) =>
              finiteString(nested(variant.variant)?.id) ===
              selectedCandidateIds[0],
          )
        : [];
    const configShas = uniqueStrings(
      selectedVariants.map((variant) => nested(variant.variant)?.configSha256),
    );
    const maxLossValues = [
      ...new Set(
        selectedVariants
          .map((variant) =>
            finiteNumber(
              nested(nested(variant.variant)?.resolvedConfig)?.MAX_LOSS_VALUE,
            ),
          )
          .filter((value): value is number => value != null),
      ),
    ];
    const sourceSha256s = uniqueStrings(
      selectedVariants.flatMap((variant) =>
        array(variant.files).map((file) => nested(file)?.sha256),
      ),
    );
    const resultLineage = nested(artifact.lineage);
    const strategies = uniqueStrings(
      selectedVariants.map(
        (variant) =>
          finiteString(nested(variant.variant)?.configName)?.split(':')[0],
      ),
    );
    return {
      ...empty,
      strategy: strategies.length === 1 ? strategies[0] : null,
      gitSha: finiteString(resultLineage?.gitSha),
      gitDirty:
        resultLineage?.gitSha != null
          ? finiteString(resultLineage?.dirtyDiffSha256) != null
          : null,
      coreConfigSha256: configShas.length === 1 ? configShas[0] : null,
      maxLossValue: maxLossValues.length === 1 ? maxLossValues[0] : null,
      sourceSha256s,
    };
  }
  if (reference.kind === 'ai_gate') {
    const lineage = nested(nested(artifact.research)?.lineage);
    return {
      ...empty,
      strategy: finiteString(nested(artifact.run)?.strategy),
      gitSha: finiteString(lineage?.gitSha),
      gitDirty:
        typeof lineage?.gitDirty === 'boolean' ? lineage.gitDirty : null,
      gateConfigIdsFingerprint: finiteString(lineage?.configIdsFingerprint),
      gateFingerprint: finiteString(lineage?.gateFingerprint),
      gateContextFingerprint: finiteString(lineage?.contextFingerprint),
      sourceSha256s: uniqueStrings(array(lineage?.sourceSha256s)),
    };
  }
  if (reference.kind === 'runtime_parity') {
    const comparison = nested(nested(artifact.replay)?.runtimeComparison);
    const replayLineages = array(nested(comparison?.lineage)?.replay)
      .map(nested)
      .map((entry) => nested(entry?.lineage))
      .filter((entry): entry is Record<string, unknown> => entry != null);
    const one = (key: string) => {
      const values = uniqueStrings(replayLineages.map((entry) => entry[key]));
      return values.length === 1 ? values[0] : null;
    };
    const maxLossValues = [
      ...new Set(
        replayLineages
          .map((entry) => finiteNumber(entry.maxLossValue))
          .filter((value): value is number => value != null),
      ),
    ];
    const dirtyValues = [
      ...new Set(
        replayLineages
          .map((entry) => entry.gitDirty)
          .filter((value): value is boolean => typeof value === 'boolean'),
      ),
    ];
    return {
      ...empty,
      strategy: (() => {
        const strategies = uniqueStrings(
          array(nested(comparison?.lineage)?.replay).map(
            (entry) => nested(entry)?.strategy,
          ),
        );
        return strategies.length === 1 ? strategies[0] : null;
      })(),
      gitSha: one('gitSha'),
      gitDirty: dirtyValues.length === 1 ? dirtyValues[0] : null,
      gateFingerprint: one('gateFingerprint'),
      runtimeConfigFingerprint: one('configFingerprint'),
      runtimeContextFingerprint: one('contextFingerprint'),
      maxLossValue: maxLossValues.length === 1 ? maxLossValues[0] : null,
    };
  }
  if (reference.kind === 'execution_calibration') {
    const samples = [
      ...array(artifact.samples),
      ...array(artifact.replayOnlySamples),
    ].map(nested);
    const lineages = samples
      .map((sample) => nested(sample?.runtimeLineage))
      .filter((lineage): lineage is Record<string, unknown> => lineage != null);
    const one = (key: string) => {
      const values = uniqueStrings(lineages.map((lineage) => lineage[key]));
      return values.length === 1 ? values[0] : null;
    };
    const dirtyValues = [
      ...new Set(
        lineages
          .map((lineage) => lineage.gitDirty)
          .filter((value): value is boolean => typeof value === 'boolean'),
      ),
    ];
    const maxLossValues = [
      ...new Set(
        lineages
          .map((lineage) => finiteNumber(lineage.maxLossValue))
          .filter((value): value is number => value != null),
      ),
    ];
    return {
      ...empty,
      strategy: (() => {
        const strategies = uniqueStrings(
          samples.map((sample) => sample?.strategy),
        );
        return strategies.length === 1 ? strategies[0] : null;
      })(),
      gitSha: one('gitSha'),
      gitDirty: dirtyValues.length === 1 ? dirtyValues[0] : null,
      gateFingerprint: one('gateFingerprint'),
      runtimeConfigFingerprint: one('configFingerprint'),
      runtimeContextFingerprint: one('contextFingerprint'),
      maxLossValue: maxLossValues.length === 1 ? maxLossValues[0] : null,
      sourceSha256s: uniqueStrings([
        ...array(nested(artifact.sources)?.sha256s),
        ...array(artifact.sourceSha256s),
      ]),
    };
  }
  return empty;
};

const verifyCompletedCoreResearchBundle = async ({
  artifact,
  resultPath,
  resultSha256,
}: {
  artifact: Record<string, unknown>;
  resultPath: string;
  resultSha256: string;
}) => {
  const researchId = finiteString(artifact.researchId);
  const specSha256 = finiteString(artifact.specSha256);
  assert(researchId != null, 'core result researchId is required');
  assert(specSha256 != null, 'core result specSha256 is required');
  const researchDir = path.dirname(resultPath);
  const manifestPath = path.join(researchDir, 'manifest.json');
  const specPath = path.join(researchDir, 'spec.json');
  const manifestBytes = await fs.readFile(manifestPath).catch(() => null);
  const specBytes = await fs.readFile(specPath).catch(() => null);
  assert(
    manifestBytes != null && specBytes != null,
    'core result must belong to a completed core research bundle',
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<
    string,
    unknown
  >;
  const artifactHashes =
    manifest.artifactHashes != null &&
    typeof manifest.artifactHashes === 'object' &&
    !Array.isArray(manifest.artifactHashes)
      ? (manifest.artifactHashes as Record<string, unknown>)
      : null;
  const parsedSpec = JSON.parse(specBytes.toString('utf8')) as unknown;
  assert(
    manifest.schema === 'tradejs-core-research-manifest/v1' &&
      manifest.status === 'completed' &&
      manifest.researchId === researchId &&
      manifest.specSha256 === specSha256 &&
      artifactHashes?.['result.json'] === resultSha256 &&
      createHash('sha256')
        .update(canonicalStrategyReleaseJson(parsedSpec))
        .digest('hex') === specSha256,
    'core result is not bound by its completed core research manifest',
  );
  for (const [relativePath, expectedSha256] of Object.entries(
    artifactHashes ?? {},
  )) {
    assert(
      !path.isAbsolute(relativePath) &&
        !relativePath.split(/[\\/]/).includes('..'),
      `core bundle artifact ${relativePath} escapes its research directory`,
    );
    assert(
      typeof expectedSha256 === 'string' && SHA256_RE.test(expectedSha256),
      `core bundle artifact ${relativePath} has an invalid checksum`,
    );
    const actualSha256 = await strategyEvidenceFileSha256(
      path.join(researchDir, relativePath),
    );
    assert(
      actualSha256 === expectedSha256,
      `core bundle artifact ${relativePath} checksum mismatch`,
    );
  }
};

export async function collectReleaseEvidenceReferences(
  references: StrategyReleaseEvidenceReference[],
) {
  return Promise.all(
    references.map(async (reference) => {
      const actualSha256 = await strategyEvidenceFileSha256(reference.path);
      assert(
        actualSha256 === reference.sha256,
        `evidence ${reference.artifactId} checksum mismatch`,
      );
      let artifact: Record<string, unknown>;
      try {
        const parsed = JSON.parse(
          await fs.readFile(reference.path, 'utf8'),
        ) as unknown;
        assert(
          parsed != null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed),
          `evidence ${reference.artifactId} must be a JSON object`,
        );
        artifact = parsed as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `Invalid strategy release: evidence ${reference.artifactId} is not valid JSON: ${(error as Error).message}`,
        );
      }
      const nested = (value: unknown) =>
        value != null && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      const array = (value: unknown) => (Array.isArray(value) ? value : []);
      const semanticallyValid =
        reference.kind === 'core_research'
          ? artifact.schema === 'tradejs-core-research-result/v1' ||
            (artifact.schema === 'tradejs-core-research-manifest/v1' &&
              artifact.status === 'completed')
          : reference.kind === 'ai_gate'
            ? nested(artifact.run)?.mode === 'local-deterministic' &&
              nested(artifact.research)?.lineage != null &&
              nested(artifact.outcome) != null
            : reference.kind === 'runtime_parity'
              ? artifact.reportType === 'replay-runtime-evidence' &&
                nested(nested(artifact.replay)?.runtimeComparison) != null
              : reference.kind === 'execution_calibration'
                ? artifact.reportType === 'execution-calibration' &&
                  nested(artifact.summary) != null
                : reference.kind === 'runtime_evidence'
                  ? artifact.reportType === 'runtime-evidence'
                  : artifact.reportType === 'runtime-scorecard';
      assert(
        semanticallyValid,
        `evidence ${reference.artifactId} does not match ${reference.kind}`,
      );
      if (
        reference.kind === 'core_research' &&
        artifact.schema === 'tradejs-core-research-result/v1'
      ) {
        await verifyCompletedCoreResearchBundle({
          artifact,
          resultPath: reference.path,
          resultSha256: actualSha256,
        });
      }
      const releaseAssertions = (() => {
        if (reference.kind === 'core_research') {
          const evidence = nested(artifact.evidence);
          const comparisons = array(artifact.comparisons)
            .map(nested)
            .filter((entry): entry is Record<string, unknown> => entry != null);
          const variants = array(artifact.variants)
            .map(nested)
            .filter((entry): entry is Record<string, unknown> => entry != null);
          const hasCohorts = (value: unknown) => {
            const cohorts = nested(value);
            return ['ALL', 'LONG', 'SHORT'].every(
              (cohort) => nested(cohorts?.[cohort]) != null,
            );
          };
          const directionalEvidenceComplete =
            variants.length > 0 &&
            variants.every(
              (variant) =>
                hasCohorts(nested(variant.full)?.cohorts) &&
                array(variant.terminal).every((window) =>
                  hasCohorts(nested(window)?.cohorts),
                ) &&
                array(variant.folds).every((window) =>
                  hasCohorts(nested(window)?.cohorts),
                ),
            );
          const evidenceComplete = [
            'terminals',
            'folds',
            'coldStart',
            'costStress',
            'delayStress',
            'fastNonFast',
            'runtimeParity',
          ].every((key) => evidence?.[key] === 'present');
          const reconciled =
            variants.length > 0 &&
            variants.every(
              (variant) => nested(variant.reconciliation)?.status === 'match',
            );
          const selectedCandidateIds = uniqueStrings(
            comparisons
              .filter(
                (comparison) => nested(comparison.selection)?.passed === true,
              )
              .map((comparison) => comparison.candidateId),
          );
          const selected = selectedCandidateIds.length === 1;
          const finalStage =
            artifact.stage === 'isolated_long' ||
            artifact.stage === 'confirmation';
          const verified =
            finalStage &&
            evidenceComplete &&
            directionalEvidenceComplete &&
            reconciled &&
            selected;
          return {
            coreEdgeVerified: verified,
            currentMarketSuitable: verified,
          };
        }
        if (reference.kind === 'ai_gate') {
          const outcome = nested(artifact.outcome);
          const approvedRisk = nested(outcome?.approvedRisk);
          const terminalWindows = array(
            nested(artifact.research)?.terminalWindows,
          )
            .map(nested)
            .filter((entry): entry is Record<string, unknown> => entry != null);
          const hasLongShortDirections = (value: unknown) => {
            const directions = new Map(
              array(value)
                .map(nested)
                .filter(
                  (entry): entry is Record<string, unknown> => entry != null,
                )
                .map((entry) => [finiteString(entry.direction), entry]),
            );
            return ['LONG', 'SHORT'].every(
              (direction) => nested(directions.get(direction)?.summary) != null,
            );
          };
          const directionalEvidenceComplete =
            hasLongShortDirections(artifact.byDirection) &&
            terminalWindows.every((window) =>
              hasLongShortDirections(window.byDirection),
            );
          const terminalsPass =
            terminalWindows.length > 0 &&
            terminalWindows.every((window) => {
              const terminalOutcome = nested(window.outcome);
              return (
                window.complete === true &&
                Number(terminalOutcome?.approved ?? 0) > 0 &&
                Number(
                  nested(terminalOutcome?.approvedRisk)?.totalProfit ??
                    Number.NEGATIVE_INFINITY,
                ) > 0
              );
            });
          return {
            aiGateAddsValue:
              Number(outcome?.expectancyDelta ?? Number.NEGATIVE_INFINITY) >
                0 &&
              Number(approvedRisk?.totalProfit ?? Number.NEGATIVE_INFINITY) >
                0 &&
              Number(approvedRisk?.profitFactor ?? Number.NEGATIVE_INFINITY) >
                1 &&
              directionalEvidenceComplete &&
              terminalsPass,
          };
        }
        if (reference.kind === 'runtime_parity') {
          const comparison = nested(nested(artifact.replay)?.runtimeComparison);
          const counts = nested(comparison?.counts);
          const matched = Number(counts?.matched ?? 0);
          const backtestOnly = Number(counts?.backtestOnly ?? 0);
          const runtimeOnly = Number(counts?.runtimeOnly ?? 0);
          return {
            runtimeParityVerified:
              matched > 0 &&
              backtestOnly === 0 &&
              runtimeOnly === 0 &&
              nested(comparison?.lineage)?.reason == null,
          };
        }
        if (reference.kind === 'execution_calibration') {
          const counts = nested(artifact.counts);
          const all = nested(nested(artifact.summary)?.all);
          const residual = Number(
            nested(all?.residualVsCurrentModelBps)?.avg ?? Number.NaN,
          );
          return {
            executionModelVerified:
              Number(counts?.fullTelemetryTrades ?? 0) > 0 &&
              Number.isFinite(residual) &&
              Math.abs(residual) <= 3,
          };
        }
        return {};
      })();
      const lineage = extractEvidenceLineage({
        artifact,
        reference,
        nested,
        array,
      });
      return { ...reference, verified: true, lineage, releaseAssertions };
    }),
  );
}
