import type { Direction, TestTradeExitReason } from '@tradejs/types';

export const CORE_RESEARCH_SCHEMA = 'tradejs-core-research/v1' as const;
export const CORE_RESEARCH_RESULT_SCHEMA =
  'tradejs-core-research-result/v1' as const;
export const CORE_RESEARCH_LEDGER_SCHEMA =
  'tradejs-core-research-ledger/v1' as const;

export type CoreResearchCohort = 'ALL' | 'LONG' | 'SHORT';
export type CoreResearchTarget = CoreResearchCohort;

export type CoreResearchVariant = {
  id: string;
  label: string;
  role: 'control' | 'candidate';
  configName: string;
  resolvedConfig: Record<string, unknown>;
  configSha256: string;
  files: string[];
  runId?: string;
  command?: string[];
  coldStartFiles?: Record<string, string[]>;
  confirmationFiles?: string[];
  stressFiles?: Record<string, string[]>;
  traceFiles?: string[];
  runtimeParityFiles?: string[];
};

export type CoreResearchThresholdRule = {
  metric:
    | 'pnl'
    | 'pnlPerTrade'
    | 'profitFactor'
    | 'winRatePct'
    | 'realizedMaxDrawdown'
    | 'cadencePerDay';
  comparison: 'gt' | 'gte' | 'lt' | 'lte';
  value?: number;
  relativeToControl?: boolean;
};

export type CoreResearchSpec = {
  schema: typeof CORE_RESEARCH_SCHEMA;
  researchId: string;
  stage: 'screen' | 'isolated_long' | 'confirmation';
  parentResearchIds?: string[];
  strategy: string;
  createdAt: string;
  hypothesis: {
    family: string;
    claim: string;
    mechanism: string;
    target: CoreResearchTarget;
  };
  universe: {
    symbols: string[];
    sha256: string;
  };
  window: {
    start: number;
    end: number;
    terminalDays: number[];
    folds: number;
  };
  execution: {
    connector: string;
    interval: string;
    maxLossValue: number;
    feeRate?: number;
    slippageBps?: number;
    entryDelayBars?: number;
  };
  variants: CoreResearchVariant[];
  selection: {
    minimumTrades: number;
    minimumCadencePerDay: number;
    targetRules: CoreResearchThresholdRule[];
    aggregateRules: CoreResearchThresholdRule[];
    nonTargetRules: CoreResearchThresholdRule[];
    maximumPortfolioDrawdownRegressionPct?: number;
    maximumHolmPValue?: number;
    minimumPositiveFoldPct?: number;
    terminalRules?: CoreResearchThresholdRule[];
    costStressRules?: CoreResearchThresholdRule[];
  };
  robustness: {
    bootstrapIterations: number;
    confidenceLevel: number;
    clusterDays: number;
    minimumFoldTrades: number;
    costStressBps: number[];
  };
  artifacts: {
    rootDir: string;
    ledgerPath: string;
  };
  lineage?: {
    gitSha?: string;
    dirtyDiffSha256?: string;
    sourceRepository?: string;
    parentResearchIds?: string[];
  };
};

export type CoreResearchTrade = {
  sourceFile: string;
  sourceLine: number;
  sourceSha256: string;
  runId: string | null;
  configId: string;
  signalId: string;
  positionCycleId: string | null;
  setupIdentity: string;
  setupIdentitySource:
    | 'research.setupIdentity'
    | 'strategy-context'
    | 'signal-time-fallback';
  strategy: string;
  symbol: string;
  direction: Direction;
  signalTimestamp: number;
  entryTimestamp: number;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  netProfit: number;
  grossProfit: number;
  totalFee: number;
  totalSlippageCost: number;
  exitReason: TestTradeExitReason;
  regime: CoreResearchRegime;
};

export type CoreResearchRegime = {
  trend: 'bull' | 'bear' | 'neutral' | 'unknown';
  volatility: 'compressed' | 'normal' | 'expanded' | 'unknown';
  breadth: 'risk_on' | 'mixed' | 'risk_off' | 'unknown';
  derivatives: 'supportive' | 'neutral' | 'crowded' | 'unknown';
  key: string;
};

export type CoreResearchMetrics = {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  pnl: number;
  pnlPerTrade: number | null;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  profitFactorStatus: 'finite' | 'infinite_no_gross_loss' | 'undefined';
  winRatePct: number | null;
  realizedMaxDrawdown: number;
  cadencePerDay: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  payoffRatio: number | null;
  medianPnl: number | null;
  pnlP05: number | null;
  pnlP95: number | null;
  medianHoldingHours: number | null;
  maximumConsecutiveLosses: number;
};

export type CoreResearchCohortMetrics = Record<
  CoreResearchCohort,
  CoreResearchMetrics
>;

export type CoreResearchWindowMetrics = {
  label: string;
  start: number;
  end: number;
  periodDays: number;
  cohorts: CoreResearchCohortMetrics;
};

export type CoreResearchVariantAnalysis = {
  variant: CoreResearchVariant;
  files: Array<{
    path: string;
    sha256: string;
    rows: number;
    selectedTrades: number;
    rowsForDifferentRun: number;
    rowsWithoutTradeResult: number;
  }>;
  duplicateRowsDropped: number;
  setupIdentitySources: Record<
    CoreResearchTrade['setupIdentitySource'],
    number
  >;
  reconciliation: CoreResearchReconciliation;
  full: CoreResearchWindowMetrics;
  terminal: CoreResearchWindowMetrics[];
  folds: CoreResearchWindowMetrics[];
  monthly: CoreResearchWindowMetrics[];
  regimes: Record<string, CoreResearchCohortMetrics>;
  costStress: Array<{
    extraRoundTripBps: number;
    cohorts: CoreResearchCohortMetrics;
  }>;
  traceFunnel: {
    events: Record<string, number>;
    skipCounts: Record<string, number>;
  };
  latestSignalTimeRegime:
    | (CoreResearchRegime & {
        timestamp: number;
        lagToWindowEndMs: number;
      })
    | null;
  supplemental: {
    coldStart: Record<string, CoreResearchWindowMetrics>;
    stress: Record<string, CoreResearchWindowMetrics>;
    confirmation: CoreResearchWindowMetrics | null;
  };
};

export type CoreResearchReconciliation = {
  status: 'match' | 'mismatch' | 'not_requested' | 'unavailable';
  runId: string | null;
  manifestStatus: string | null;
  plannedTests: number | null;
  completedTests: number | null;
  redis: {
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
  } | null;
  export: {
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
  };
  delta: {
    trades: number;
    wins: number;
    losses: number;
    pnl: number;
  } | null;
  pnlTolerance: number | null;
  reasons: string[];
};

export type CoreResearchMatchedPair = {
  identity: string;
  control: CoreResearchTrade;
  candidate: CoreResearchTrade;
  pnlDelta: number;
  exitReasonChanged: boolean;
  entryTimestampDeltaMs: number;
  exitTimestampDeltaMs: number;
};

export type CoreResearchComparison = {
  controlId: string;
  candidateId: string;
  matched: number;
  controlOnly: number;
  candidateOnly: number;
  matchedIdentityPctOfControl: number | null;
  matchedPairs: CoreResearchMatchedPair[];
  cohorts: Record<
    CoreResearchCohort,
    {
      control: CoreResearchMetrics;
      candidate: CoreResearchMetrics;
      delta: {
        pnl: number;
        pnlPerTrade: number | null;
        profitFactor: number | null;
        winRatePct: number | null;
        realizedMaxDrawdown: number;
        cadencePerDay: number | null;
      };
      matchedPnlDelta: number;
      controlOnlyPnl: number;
      candidateOnlyPnl: number;
    }
  >;
  bootstrap: CoreResearchBootstrapResult;
  selection: CoreResearchSelectionResult;
};

export type CoreResearchBootstrapResult = {
  method: 'calendar-cluster-bootstrap';
  clusterDays: number;
  iterations: number;
  confidenceLevel: number;
  observedMeanPnlDelta: number | null;
  confidenceInterval: [number, number] | null;
  probabilityPositive: number | null;
  oneSidedPValue: number | null;
  holmAdjustedPValue: number | null;
};

export type CoreResearchSelectionResult = {
  target: CoreResearchTarget;
  passed: boolean;
  targetPassed: boolean;
  aggregatePassed: boolean;
  nonTargetPassed: boolean;
  failedRules: Array<{
    scope: CoreResearchCohort;
    metric: string;
    expected: string;
    actual: number | null;
    control: number | null;
  }>;
  warnings: string[];
};

export type CoreResearchEvidenceMatrix = {
  screen: 'present' | 'missing';
  isolatedLong: 'present' | 'missing';
  terminals: 'present' | 'missing';
  folds: 'present' | 'missing';
  coldStart: 'present' | 'missing';
  costStress: 'present' | 'missing';
  delayStress: 'present' | 'missing';
  fastNonFast: 'present' | 'missing';
  runtimeParity: 'present' | 'missing';
};

export type CoreResearchResult = {
  schema: typeof CORE_RESEARCH_RESULT_SCHEMA;
  researchId: string;
  stage: CoreResearchSpec['stage'];
  generatedAt: string;
  specSha256: string;
  lineage?: CoreResearchSpec['lineage'];
  semantics: {
    cohortOrder: CoreResearchCohort[];
    pnlPerTrade: 'cohort PnL / cohort completed positions';
    drawdown: {
      ALL: 'time-ordered aggregate portfolio realized drawdown';
      LONG: 'time-ordered LONG-only realized drawdown';
      SHORT: 'time-ordered SHORT-only realized drawdown';
    };
    regimeCausality: 'signal-time payload.additionalIndicators.baseContext only';
  };
  variants: CoreResearchVariantAnalysis[];
  comparisons: CoreResearchComparison[];
  multipleTesting: {
    family: string;
    hypotheses: number;
    method: 'Holm';
  };
  evidence: CoreResearchEvidenceMatrix;
  overfittingDiagnostics: {
    deflatedSharpe: Record<
      string,
      {
        periods: number;
        observedSharpe: number | null;
        expectedMaximumSharpe: number | null;
        probabilityAboveSelectionBias: number | null;
      }
    >;
    probabilityOfBacktestOverfitting: {
      method: 'CSCV';
      combinations: number;
      probability: number | null;
    };
  };
  artifactHashes: Record<string, string>;
};

export type CoreResearchStageIndex = {
  schema: 'tradejs-core-research-stage-index/v1';
  generatedAt: string;
  families: Array<{
    family: string;
    experiments: Array<{
      researchId: string;
      stage: CoreResearchSpec['stage'];
      parentResearchIds: string[];
      specSha256: string;
      manifestStatus: 'prepared' | 'completed';
      passedCandidates: string[];
      evidence: CoreResearchEvidenceMatrix | null;
    }>;
  }>;
};

export type CoreResearchLedgerRecord = {
  schema: typeof CORE_RESEARCH_LEDGER_SCHEMA;
  sequence: number;
  recordedAt: string;
  researchId: string;
  event:
    | 'prepared'
    | 'run_started'
    | 'run_completed'
    | 'run_failed'
    | 'analysis_started'
    | 'analysis_failed'
    | 'analysis_completed'
    | 'verified';
  specSha256: string;
  hypothesisFamily: string;
  hypothesesInRecord: number;
  artifactHashes: Record<string, string>;
  previousHash: string | null;
  recordHash: string;
};
