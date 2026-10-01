export type JevDimension =
  | 'trend'
  | 'swing'
  | 'participation'
  | 'setupParticipation'
  | 'extension'
  | 'confirmation'
  | 'setupStrength'
  | 'geometry';
export type JevScores = Record<JevDimension, number | null>;
export type JevFeature = number | string | boolean | null;
export interface JevFactProvenance {
  knownAt: number;
  scope: 'target' | 'strategy';
  unit?: string;
  source?: string;
}

/** Optional, signal-time facts supplied by any strategy package. */
export interface JevEvidence {
  version: string;
  knownAt: number;
  facts: Record<string, JevFeature>;
  geometry?: Record<string, JevFeature>;
  /** Optional per-fact provenance; omitted facts use the evidence-level knownAt. */
  factDetails?: Record<string, JevFactProvenance>;
}

export interface JevProviderConfig {
  endpoint: string;
  model: string;
}

/** Credentials belong to Account settings, never to this configuration. */
export interface JevConfig {
  source: 'provider' | 'recorded' | 'local';
  mode: 'observe' | 'gate';
  provider?: JevProviderConfig;
  recordsDir?: string;
  modelFile?: string;
  modelSha256?: string;
  minScores?: Partial<Record<JevDimension, number>>;
  requireGeometry?: boolean;
}

export interface JevInput {
  schema: 'tradejs-jev-input/v4';
  strategy: string;
  symbol: string;
  interval: string;
  timestamp: number;
  direction: 'LONG' | 'SHORT';
  features: Record<string, JevFeature>;
  provenance: Record<string, JevFactProvenance>;
  missing: Record<string, string>;
  questions: JevDimension[];
  geometryStatus: 'available' | 'facts_only' | 'absent' | 'invalid';
}

export interface JevScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevResponse {
  model: string;
  answers: Partial<Record<JevDimension, JevScoreAnswer>>;
  usage?: Record<string, unknown>;
}

export interface JevRecord {
  schema: 'tradejs-jev-record/v4';
  id: string;
  inputHash: string;
  questionsHash: string;
  provider: JevProviderConfig;
  input: JevInput;
  response: JevResponse;
  scores: JevScores;
  createdAt: string;
  elapsedMs: number;
}

export interface SignalAssessment {
  schema: 'tradejs-signal-assessment/v5';
  source: JevConfig['source'];
  mode: JevConfig['mode'];
  status: 'available' | 'unavailable';
  recordId?: string;
  inputHash: string;
  questionsHash: string;
  model: string;
  scores: JevScores;
  confidence: JevScores;
  geometryStatus: JevInput['geometryStatus'];
  levelsValid: boolean | null;
}

export type JevTree =
  | { value: number; samples: number }
  | {
      feature: string;
      operator: 'lte' | 'eq';
      value: JevFeature;
      missingLeft: boolean;
      left: JevTree;
      right: JevTree;
    };

export interface JevGateModel {
  schema: 'tradejs-jev-gate/v2';
  inputSchema: JevInput['schema'];
  strategy: string;
  questionsHash: string;
  teacherModel: string;
  trees: Record<JevDimension, JevTree | null>;
  training: {
    datasetHash: string;
    trainEnd: number;
    validationEnd: number;
    testEnd: number;
    maxDepth: number;
    minLeaf: number;
  };
}

export interface JevStudyRow {
  schema: 'tradejs-jev-study/v4';
  signalId: string;
  record: JevRecord;
  /** Outcome is analysis-only and is never included in JevInput. */
  profit?: number;
  baselineAllowed?: boolean;
}
