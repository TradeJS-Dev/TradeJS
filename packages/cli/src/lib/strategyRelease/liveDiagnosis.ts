import {
  STRATEGY_LIVE_DIAGNOSIS_SCHEMA,
  type StrategyLiveDiagnosis,
  type StrategyReleaseManifest,
} from '@tradejs/types';

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
      schemaVersion: number;
      strategyRevision: string | null;
      deploymentCompositionId: string | null;
      strategyPackageVersion: string | null;
      strategyDependencyVersions: Record<string, string> | null;
      runtimePackageVersion: string | null;
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
    lineage.schemaVersion === 3 &&
    lineage.strategyRevision != null &&
    lineage.deploymentCompositionId != null &&
    lineage.strategyPackageVersion != null &&
    lineage.strategyDependencyVersions != null &&
    lineage.runtimePackageVersion != null;
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
