export const STRATEGY_RELEASE_SCHEMA = 'tradejs-strategy-release/v1' as const;
export const STRATEGY_EVIDENCE_MARKERS_SCHEMA =
  'tradejs-strategy-evidence-markers/v1' as const;
export const STRATEGY_LIVE_DIAGNOSIS_SCHEMA =
  'tradejs-strategy-live-diagnosis/v1' as const;

export type StrategyReleaseVerdict =
  | 'READY_FOR_RUNTIME'
  | 'UNSUITABLE_FOR_CURRENT_MARKET'
  | 'INSUFFICIENT_EVIDENCE';

export type StrategyReleaseResearchDecisionAction =
  | 'REPAIR_RECENT_DIRECTION'
  | 'START_MICRO_FORWARD'
  | 'MICRO_FORWARD_READY'
  | 'FORWARD_BLOCKED'
  | 'STOP_RESEARCH';

export type StrategyReleaseResearchDecisionBlocker =
  | 'HISTORICAL_MATRIX_INCOMPLETE'
  | 'HISTORICAL_EDGE_FAILED'
  | 'CANDIDATE_NOT_IMPLEMENTED'
  | 'FULL_PERIOD_CHART_MISSING'
  | 'FORWARD_NOT_AUTHORIZED'
  | 'RUNTIME_TARGET_UNRESOLVED'
  | 'FORWARD_RISK_MUST_BE_ONE';

export type StrategyReleaseHistoricalWindow = {
  days: number;
  coveredDays?: number;
  pnl: number;
  profitFactor: number;
  long: { pnl: number; profitFactor: number };
  short: { pnl: number; profitFactor: number };
};

export type StrategyReleaseResearchDecisionInput = {
  strategy: string;
  historicalWindows: StrategyReleaseHistoricalWindow[];
  candidateImplemented: boolean;
  exposedEvaluation: boolean;
  chartArtifact: {
    path: string;
    sha256: string;
  } | null;
  recentFailure: {
    days: number;
    direction: 'LONG' | 'SHORT';
    closedTrades: number;
    causalMechanismIdentified: boolean;
    repairRoundsUsed: number;
  } | null;
  forwardTest: {
    authorized: boolean;
    runtimeTarget: {
      userName: string;
      deploymentId: string;
      accountId: string;
      strategyConfigName: string;
    } | null;
    maxLossValue: number;
  };
};

export type StrategyReleaseResearchDecision = {
  strategy: string;
  action: StrategyReleaseResearchDecisionAction;
  repairAllowed: boolean;
  targetDirection: 'LONG' | 'SHORT' | null;
  maxLossValue: 1 | null;
  blockers: StrategyReleaseResearchDecisionBlocker[];
  summary: string;
};

export type StrategyReleaseReason =
  | 'NO_VERIFIED_CORE_EDGE'
  | 'AI_GATE_ADDS_NO_VALUE'
  | 'CURRENT_REGIME_UNSUITABLE'
  | 'RUNTIME_PARITY_BLOCKED'
  | 'EXECUTION_MODEL_UNSAFE'
  | 'RESEARCH_BUDGET_EXHAUSTED'
  | 'EVIDENCE_INCOMPLETE';

export type StrategyEvidenceMarkerType = 'G' | 'L' | 'E' | 'D' | 'P' | 'R';

export type StrategyEvidenceMarker = {
  id: string;
  type: StrategyEvidenceMarkerType;
  timestamp: number;
  label: string;
  summary: string;
  artifactId: string;
  artifactSha256: string;
  compositionId?: string;
  gitSha?: string;
  gateFingerprint?: string;
  configFingerprint?: string;
  contextFingerprint?: string;
  maxLossValue?: number;
  severity?: 'info' | 'warning' | 'blocking';
  coverage?: {
    startTime: number;
    endTime: number;
  };
};

export type StrategyEvidenceTimeline = {
  status: 'verified' | 'missing' | 'invalid';
  observedFrom: number | null;
  markers: StrategyEvidenceMarker[];
};

export type StrategyEvidenceTimelineSelector = {
  strategy: string;
  compositionId?: string | null;
  gitSha?: string | null;
  gateFingerprint?: string | null;
  configFingerprint?: string | null;
  contextFingerprint?: string | null;
  maxLossValue?: number | null;
  requireCompleteLineage?: boolean;
};

export type StrategyEvidenceMarkerPayload = {
  strategy: string;
  createdAt: number;
  markers: StrategyEvidenceMarker[];
  sourceArtifacts: Array<{
    artifactId: string;
    sha256: string;
    path?: string;
  }>;
};

export type StrategyEvidenceMarkerEnvelope = {
  schema: typeof STRATEGY_EVIDENCE_MARKERS_SCHEMA;
  artifactId: string;
  payloadSha256: string;
  payload: StrategyEvidenceMarkerPayload;
};

export type StrategyReleaseEvidenceReference = {
  kind:
    | 'core_research'
    | 'ai_gate'
    | 'runtime_parity'
    | 'execution_calibration'
    | 'runtime_evidence'
    | 'runtime_scorecard';
  artifactId: string;
  path: string;
  sha256: string;
  verified: boolean;
  lineage?: {
    strategy: string | null;
    gitSha: string | null;
    gitDirty: boolean | null;
    coreConfigSha256: string | null;
    gateConfigIdsFingerprint: string | null;
    gateFingerprint: string | null;
    runtimeConfigFingerprint: string | null;
    gateContextFingerprint: string | null;
    runtimeContextFingerprint: string | null;
    maxLossValue: number | null;
    sourceSha256s: string[];
  };
  releaseAssertions?: Partial<{
    coreEdgeVerified: boolean;
    aiGateAddsValue: boolean;
    currentMarketSuitable: boolean;
    runtimeParityVerified: boolean;
    executionModelVerified: boolean;
  }>;
};

export type StrategyReleaseManifest = {
  schema: typeof STRATEGY_RELEASE_SCHEMA;
  releaseId: string;
  strategy: string;
  createdAt: number;
  composition: {
    compositionId: string;
    gitSha: string;
    coreConfigSha256: string;
    coreExportSha256: string;
    gateConfigIdsFingerprint: string;
    runtimeConfigFingerprint: string;
    gateFingerprint: string;
    gateContextFingerprint: string;
    runtimeContextFingerprint: string;
    maxLossValue: number;
    longEnabled: boolean;
    shortEnabled: boolean;
  };
  marketWindow: {
    startTime: number;
    endTime: number;
    universeSha256: string;
    symbols: number;
    cacheOnly: true;
    terminalDays: number[];
  };
  researchBudget: {
    hypothesisFamilies: number;
    maximumVariantsPerFamily: number;
    isolatedLongFinalists: number;
    aiGateTuningRounds: number;
  };
  evidence: StrategyReleaseEvidenceReference[];
  gates: {
    coreEdgeVerified: boolean;
    aiGateAddsValue: boolean;
    currentMarketSuitable: boolean;
    runtimeParityVerified: boolean;
    executionModelVerified: boolean;
  };
  monitoring: {
    minimumProspectiveClosedTrades: number;
    minimumParityRatio: number;
    maximumOrderFailureRate: number;
    drawdownEnvelopes: Array<{
      days: number;
      p95: number;
      maximum: number;
    }>;
    rawCoreExpectancy: number | null;
    aiGateExpectancy: number | null;
    minimumRegimeCoverage: number;
    overfitProbability: number | null;
  };
  verdict: {
    status: StrategyReleaseVerdict;
    reasons: StrategyReleaseReason[];
    summary: string;
  };
  prospective: {
    status: 'not_started' | 'incubating' | 'sufficient' | 'blocked';
    evidenceBooks: Array<
      | 'micro_live'
      | 'shadow_composition'
      | 'shadow_raw_core'
      | 'gate_comparison'
    >;
    llmComparatorPolicy:
      | 'ai_approved_only'
      | 'all_core_candidates'
      | 'disabled';
  };
};

export type StrategyReleaseEnvelope = {
  schema: 'tradejs-strategy-release-envelope/v1';
  releaseId: string;
  manifestSha256: string;
  manifest: StrategyReleaseManifest;
};

export type StrategyLiveDiagnosisVerdict =
  | 'RUNTIME_DIVERGENCE'
  | 'EXPECTED_DRAWDOWN'
  | 'GENERALIZATION_FAILURE'
  | 'INSUFFICIENT_EVIDENCE';

export type StrategyLiveDiagnosis = {
  schema: typeof STRATEGY_LIVE_DIAGNOSIS_SCHEMA;
  strategy: string;
  compositionId: string;
  createdAt: number;
  verdict: StrategyLiveDiagnosisVerdict;
  subtype:
    | 'RAW_CORE_DECAY'
    | 'AI_GATE_FAILURE'
    | 'REGIME_SHIFT'
    | 'SUSPECTED_HISTORICAL_OVERFIT'
    | null;
  confidence: 'low' | 'medium' | 'high';
  evidence: {
    lineageComparable: boolean;
    riskScaleComparable: boolean;
    releaseMaxLossValue: number | null;
    runtimeMaxLossValue: number | null;
    riskScaleRatio: number | null;
    parityRatio: number | null;
    orderFailureRate: number | null;
    observedDrawdown: number | null;
    normalizedObservedDrawdown: number | null;
    historicalDrawdownP95: number | null;
    historicalDrawdownMaximum: number | null;
    closedTrades: number;
    rawCoreExpectancyDelta: number | null;
    aiGateAddedValue: number | null;
    regimeCoverage: number | null;
    overfitProbability: number | null;
  };
  explanation: string;
  recommendations: string[];
};

export type StrategyLiveDiagnosisEnvelope = {
  schema: 'tradejs-strategy-live-diagnosis-envelope/v1';
  diagnosisId: string;
  diagnosisSha256: string;
  diagnosis: StrategyLiveDiagnosis;
};

export type StrategyEvidenceRetentionEntry = {
  path: string;
  kind:
    | 'operational_redis'
    | 'verbose_payload'
    | 'verified_runtime_bundle'
    | 'compact_ledger';
  createdAt: number;
  verified: boolean;
  aggregated: boolean;
  bytes: number;
};

export type StrategyEvidenceRetentionPlan = {
  keep: StrategyEvidenceRetentionEntry[];
  delete: StrategyEvidenceRetentionEntry[];
  bytesReclaimable: number;
};
