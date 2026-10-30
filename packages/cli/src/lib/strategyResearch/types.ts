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
  policy: ResearchEntryPolicy;
  discovery: Record<'LONG' | 'SHORT', AiPocketSearchResult>;
};
export type ResearchEvaluation = {
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
  trials: {
    core: number;
    predicates: number;
    combinations: number;
    frozenGates: number;
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
