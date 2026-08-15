import type {
  AiTrainEvaluation,
  AiTrainQualityThresholdSummary,
} from '../aiTrainMetrics';

export type AiPocketPrimitive = string | number | boolean | null;

export type AiPocketFeatureMap = Record<string, AiPocketPrimitive>;

export type AiPocketFeaturePolicy = 'causal-stationary' | 'all';

export type AiPocketCoverageFamily = 'cmc' | 'coinalyze';

export type AiPocketCadenceMode = 'auto' | 'fixed';

export type AiPocketCadenceProfile = {
  mode: AiPocketCadenceMode;
  lowCadence: boolean;
  sparseSample: boolean;
  adaptiveThresholds: boolean;
  trainRows: number;
  trainEvents: number;
  trainPeriodDays: number | null;
  trainEventsPerDay: number | null;
  validationRows: number;
  validationEvents: number;
  testRows: number;
  testEvents: number;
  minSupport: number;
  minEvents: number;
  minValidationSupport: number;
  minValidationEvents: number;
  maxEventCountShare: number;
};

export type AiPocketFeatureCoverage = Record<AiPocketCoverageFamily, boolean>;

export type AiPocketSearchObjective =
  | 'standalone'
  | 'add-to-gate'
  | 'filter-gate';

export type AiPocketFeaturePathClassification =
  | 'eligible'
  | 'data-quality'
  | 'metadata'
  | 'derived-policy'
  | 'raw-nonstationary';

export type AiPocketExcludedFeatureClassification = Exclude<
  AiPocketFeaturePathClassification,
  'eligible'
>;

export type AiPocketSearchRow = AiTrainEvaluation & {
  signalId?: string;
  symbol?: string;
  strategy?: string;
  modelCandidate?: boolean;
  features: AiPocketFeatureMap;
  featureCoverage?: AiPocketFeatureCoverage;
};

export type AiPocketSearchOptions = {
  minSupport?: number;
  minProfitFactor?: number;
  minTotalProfit?: number;
  minWinRate?: number;
  maxDepth?: number;
  maxAtomicPredicates?: number;
  maxCombinations?: number;
  maxCategories?: number;
  top?: number;
  progressInterval?: number;
  onProgress?: (progress: AiPocketSearchProgress) => void;
  validationRows?: AiPocketSearchRow[];
  testRows?: AiPocketSearchRow[];
  minValidationSupport?: number;
  minEvents?: number;
  minValidationEvents?: number;
  maxBatch?: number;
  maxEventCountShare?: number;
  maxSymbolCountShare?: number;
  objective?: AiPocketSearchObjective;
  baselineRows?: AiPocketSearchRow[];
  validationBaselineRows?: AiPocketSearchRow[];
  testBaselineRows?: AiPocketSearchRow[];
  allowRiskRegression?: boolean;
  requireValidationEligibility?: boolean;
  dedupeEquivalentSelections?: boolean;
  requiredFeatureFamilies?: AiPocketCoverageFamily[];
  excludedFeatureFamilies?: AiPocketCoverageFamily[];
  cadenceProfile?: AiPocketCadenceProfile;
};

export type AiPocketPredicate =
  | {
      id: string;
      featureKey: string;
      label: string;
      kind: 'numeric';
      op: '<=' | '>=';
      threshold: number;
    }
  | {
      id: string;
      featureKey: string;
      label: string;
      kind: 'category';
      op: '==';
      value: string | boolean | null;
    };

export type AiPocketSummary = {
  support: number;
  supportRatio: number;
  events: number;
  eventBalancedProfit: number;
  tradesPerEvent: number | null;
  p95Batch: number;
  maxBatch: number;
  topEventCountShare: number | null;
  topEventProfitShare: number | null;
  topSymbolCountShare: number | null;
  topSymbolProfitShare: number | null;
  totalProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  winRate: number | null;
  avgProfit: number | null;
  maxDrawdown: number;
  maxDrawdownPctOfGrossProfit: number | null;
  maxDrawdownPctOfTotalProfit: number | null;
  recoveryFactor: number | null;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgTradesPerDay: number | null;
  avgTradesPerWeek: number | null;
  avgProfitPerDay: number | null;
  avgProfitPerMonth: number | null;
  losingMonths: number;
  worstMonth: { month: string; totalProfit: number } | null;
  directionCounts: Record<string, number>;
  topSymbols: Array<{ symbol: string; count: number; totalProfit: number }>;
};

export type AiPocketResult = {
  id: string;
  depth: number;
  predicates: AiPocketPredicate[];
  condition: string;
  summary: AiPocketSummary;
  validationSummary?: AiPocketSummary;
  testSummary?: AiPocketSummary;
  objectiveSummary?: AiPocketSummary;
  validationObjectiveSummary?: AiPocketSummary;
  testObjectiveSummary?: AiPocketSummary;
  validationScore?: number;
  testScore?: number;
  score: number;
  readiness: 'production-candidate' | 'research-only';
  readinessReasons: string[];
};

export type AiPocketSearchResult = {
  objective: AiPocketSearchObjective;
  baseline: AiPocketSummary;
  validationBaseline?: AiPocketSummary;
  testBaseline?: AiPocketSummary;
  objectiveBaseline?: AiPocketSummary;
  validationObjectiveBaseline?: AiPocketSummary;
  testObjectiveBaseline?: AiPocketSummary;
  predicates: AiPocketPredicate[];
  positivePockets: AiPocketResult[];
  negativePockets: AiPocketResult[];
  stats: {
    rows: number;
    featureKeys: number;
    predicates: number;
    atomicPredicatesUsed: number;
    estimatedCombinations: number;
    combinationsEvaluated: number;
    validationRows: number;
    testRows: number;
    duplicatePocketsSkipped: number;
    featureFamiliesUsed: string[];
    requiredFeatureFamilies: AiPocketCoverageFamily[];
    excludedFeatureFamilies: AiPocketCoverageFamily[];
    cadence: AiPocketCadenceProfile;
    truncated: boolean;
  };
};

export type AiPocketCoverageSummary = {
  family: AiPocketCoverageFamily;
  rows: number;
  rowRatio: number;
  events: number;
  eventRatio: number;
  minTimestamp: number | null;
  maxTimestamp: number | null;
};

export type AiPocketCoverageSearchResult = {
  family: AiPocketCoverageFamily;
  coverage: AiPocketCoverageSummary;
  scopeRows: number;
  trainRows: number;
  validationRows: number;
  testRows: number;
  search: AiPocketSearchResult;
};

export type AiPocketSearchProgressPhase =
  | 'features'
  | 'predicates'
  | 'masks'
  | 'combinations';

export type AiPocketSearchProgress = {
  phase: AiPocketSearchProgressPhase;
  current: number;
  total: number;
  done: boolean;
  truncated: boolean;
};

export type AiPocketSearchRunReport = {
  strategy: string;
  filePaths: string[];
  sourceRows: number;
  selectedRows: number;
  evaluatedRows: number;
  scope: string;
  direction: string | null;
  scopeRows: number;
  trainRows: number;
  validationRows: number;
  testRows: number;
  scanned: number;
  dateSkipped: number;
  failed: number;
  recent: number;
  skip: number;
  since: number | null;
  until: number | null;
  period: string | null;
  minQuality: number;
  qualityThresholds: number[];
  includeSymbol: boolean;
  includeGateContext: boolean;
  featureProfile?: 'compact' | 'all';
  featurePolicy?: AiPocketFeaturePolicy;
  coverageMode?: 'auto' | 'full';
  cadenceMode?: AiPocketCadenceMode;
  coverageSearches?: Array<{
    family: AiPocketCoverageFamily;
    coverage: AiPocketCoverageSummary;
    scopeRows: number;
    trainRows: number;
    validationRows: number;
    testRows: number;
  }>;
  featurePolicyAudit?: Partial<
    Record<
      AiPocketExcludedFeatureClassification,
      { paths: number; samples: string[] }
    >
  >;
  objective?: AiPocketSearchObjective;
  validationSplit: number;
  testSplit: number;
  sealedTest?: {
    sealed: boolean;
    rows: number;
    events: number;
    startTimestamp: number | null;
    endTimestamp: number | null;
  };
  minValidationSupport: number;
  reportPath: string;
  search: {
    maxDepth: number;
    minSupport: number;
    minProfitFactor: number;
    minWinRate: number;
    minTotalProfit: number;
    maxAtomicPredicates: number;
    maxCombinations: number;
    minEvents?: number;
    minValidationEvents?: number;
    maxBatch?: number;
    maxEventCountShare?: number;
    maxSymbolCountShare?: number;
    allowRiskRegression?: boolean;
    requireValidationEligibility?: boolean;
    cadence?: AiPocketCadenceProfile;
    top: number;
  };
};

export type AiPocketMarkdownReport = {
  generatedAt: number;
  run: AiPocketSearchRunReport;
  currentGate: {
    qualityThresholds: AiTrainQualityThresholdSummary[];
  };
  pocketSearch: AiPocketSearchResult;
  coverageSearches?: AiPocketCoverageSearchResult[];
  errors: string[];
};
