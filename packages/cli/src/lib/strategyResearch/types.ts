import type { ResearchEntryPolicy, Candle } from '@tradejs/types';
import type {
  CoreResearchSpec,
  CoreResearchVariant,
  CoreResearchTrade,
  CoreResearchWindowMetrics,
} from '../coreResearch/types';
import type {
  AiPocketSearchResult,
  AiPocketSearchRow,
} from '../aiPocketSearch';

export type StrategyResearchSpec = {
  schema: 'tradejs-strategy-research/v1';
  core: CoreResearchSpec;
  /** Previously inspected history is always retrospective, even after a new split. */
  history: 'retrospective' | 'unopened';
  priorResearchIds: string[];
  frozenFrom?: string;
  testSince: number;
  minQuality: number;
  budget: {
    maxVariants: number;
    maxRows: number;
    maxCombinations: number;
    maxMinutes: number;
    parallel: number;
    minimumFreeMemoryMb: number;
  };
  selection: {
    minimumEvents: number;
    minimumProfitFactor: number;
    minimumCadencePerDay: number;
    maximumDrawdown: number;
    maximumLossStreak: number;
    maximumEventShare: number;
    maximumSymbolShare: number;
    extraRoundTripBps: number;
  };
  diagnostics: {
    samplePerSideAndOutcome: number;
    horizons: number[];
    requiredPaths: string[];
    minimumContextCoverage: number;
  };
  portfolio: { maxConcurrentPositions: number; maxOpenRisk: number };
};

export type ResearchStage = {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  artifacts: Record<string, string>;
  error?: string;
};
export type ResearchState = {
  schema: 'tradejs-strategy-research-state/v1';
  specSha256: string;
  lineage: Record<string, string>;
  status: 'running' | 'completed' | 'failed';
  elapsedMs?: number;
  stages: Record<string, ResearchStage>;
  holdoutOpenedAt?: string;
  error?: string;
};
export type ResearchDataset = {
  variant: CoreResearchVariant;
  trades: CoreResearchTrade[];
  rows: AiPocketSearchRow[];
  samples: Array<{
    trade: CoreResearchTrade;
    candles: Candle[];
    stop: number | null;
    target: number | null;
  }>;
  contextCoverage: Record<string, number>;
  purgedLabels: number;
  funnel?: Awaited<
    ReturnType<
      typeof import('../coreResearch/trace').summarizeCoreResearchTrace
    >
  > | null;
  eventStudy?: ReturnType<typeof import('./events').summarizeResearchEvents>;
};
export type FrozenResearchGate = {
  coreId: string;
  jev?: 'enabled' | 'disabled';
  policy: ResearchEntryPolicy;
  discovery: Record<'LONG' | 'SHORT', AiPocketSearchResult>;
};
export type ResearchComposition = {
  id: string;
  coreId: string;
  role: 'baseline' | 'candidate';
  policy: ResearchEntryPolicy;
  jev?: 'enabled' | 'disabled';
  jevPairId?: string;
};
export type ResearchDirectionSelection = {
  id: string;
  sourceId: string;
  method: 'existing-dev-trades';
  window: { start: number; end: number };
  directions: Array<'LONG' | 'SHORT'>;
  sides: Record<
    'LONG' | 'SHORT',
    {
      eligible: boolean;
      events: number;
      metrics: CoreResearchWindowMetrics['cohorts']['ALL'];
      reasons: string[];
    }
  >;
  reason: string;
};
export type FrozenResearchSelection = {
  schema: 'tradejs-research-selection/v1';
  primaryId: string | null;
  compositions: ResearchComposition[];
  directionSelections: ResearchDirectionSelection[];
  development: ResearchEvaluation[];
  jevPair?: FrozenJevResearchPair | null;
};
export type FrozenJevResearchPair = {
  coreId: string;
  pairId: string;
  withJev: ResearchComposition;
  withoutJev: ResearchComposition;
  preferredOnDev: 'enabled' | 'disabled';
  method: 'independently-fitted-filters' | 'current-gate-toggle';
};
export type ResearchJevComparison = {
  status: 'not-configured' | 'inconclusive' | 'improved' | 'worse';
  reason: string;
  pair?: FrozenJevResearchPair;
  evidence: 'retrospective' | 'unopened';
  pnlDelta?: number;
  drawdownDelta?: number;
  jevCoverage?: { testRows: number; scoredRows: number; scoredEvents: number };
  dailyPnlDeltaInterval95?: [number, number] | null;
  withJev?: CoreResearchWindowMetrics;
  withoutJev?: CoreResearchWindowMetrics;
  dev: Array<{
    pairId: string;
    withJev: CoreResearchWindowMetrics | null;
    withoutJev: CoreResearchWindowMetrics | null;
  }>;
};
export type ResearchEvaluation = {
  jev?: 'enabled' | 'disabled';
  jevPairId?: string;
  id: string;
  coreId: string;
  role: 'baseline' | 'candidate';
  policy: ResearchEntryPolicy;
  windows: CoreResearchWindowMetrics[];
  testEvents: number;
  eventShare: number;
  symbolShare: number;
  stress: CoreResearchWindowMetrics;
  passed: boolean;
  reasons: string[];
  equity: Array<[number, number]>;
  testEquity: Array<[number, number]>;
  testDrawdown: Array<[number, number]>;
  directionEquity: Record<'LONG' | 'SHORT', Array<[number, number]>>;
  capacity: {
    rejected: number;
    peakPositions: number;
    projected: CoreResearchWindowMetrics;
  };
  funnel?: ResearchDataset['funnel'];
};
export type ResearchConclusion = {
  status:
    | 'data-error'
    | 'rejected'
    | 'insufficient-data'
    | 'candidate-confirmed';
  selectedId: string | null;
  reasons: string[];
  nextAction: string;
  evaluations: ResearchEvaluation[];
  directionSelections: ResearchDirectionSelection[];
  jevComparison?: ResearchJevComparison;
  trials: {
    core: number;
    predicates: number;
    combinations: number;
    frozenGates: number;
    directionScreens?: number;
  };
};

/** Only the adapter runs native tools; orchestration and reports are testable offline. */
export interface StrategyResearchBackend {
  selectPartition(
    spec: StrategyResearchSpec,
    variant: CoreResearchVariant,
  ): Promise<{ testSince: number; events: number; method: string }>;
  lineage(): Promise<Record<string, string>>;
  preflight(spec: StrategyResearchSpec): Promise<unknown>;
  runVariant(
    spec: StrategyResearchSpec,
    variant: CoreResearchVariant,
    directory: string,
    onRunId: (runId: string) => Promise<void>,
    runId?: string,
    confirmation?: boolean,
  ): Promise<CoreResearchVariant>;
  loadDataset(
    spec: StrategyResearchSpec,
    variant: CoreResearchVariant,
    directory: string,
    discoveryOnly: boolean,
  ): Promise<ResearchDataset>;
}
