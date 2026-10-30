/** A frozen, simulation-only entry policy. Never valid in a live runtime. */
export type ResearchEntryPredicate = {
  path: string;
} & (
  | { op: '<=' | '>='; value: number }
  | { op: '=='; value: string | boolean }
);

export type ResearchEntryPolicy = {
  schema: 'tradejs-research-entry-policy/v1';
  strategy: string;
  mode: 'current-gate' | 'rules';
  minQuality: number;
  /** null blocks a side; an empty conjunction explicitly passes that side. */
  rules: Record<'LONG' | 'SHORT', ResearchEntryPredicate[] | null>;
};

export type ResearchEntryDecision = {
  mode: ResearchEntryPolicy['mode'];
  allowed: boolean;
  quality?: number | null;
  reason: string;
  predicates?: Array<{
    path: string;
    actual: number | string | boolean | null;
    passed: boolean;
  }>;
};
