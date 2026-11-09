export type AiFeatureRole =
  | 'input'
  | 'data-quality'
  | 'metadata'
  | 'outcome'
  | 'policy';
export type AiFeaturePrimitive = number | string | boolean | null;

/** Explicit strategy extensions use paths in the untrimmed signal projection. */
export interface AiFeatureDefinition {
  id: string;
  version: number;
  path: string;
  source?: 'signal' | 'payload';
  stationary?: boolean;
  role: AiFeatureRole;
  scope: 'target' | 'benchmark' | 'global' | 'setup';
  unit: string;
  description: string;
  /** Arrays require an explicit causal reduction, never implicit truncation. */
  reduction?: 'last' | 'mean' | 'min' | 'max' | 'count';
  /** Source field used for a ratio; division by zero or missing returns null. */
  divideBy?: string;
}

export interface AiFeatureSnapshot {
  schema: 'tradejs-ai-features/v1';
  definitions: readonly AiFeatureDefinition[];
  values: Record<string, AiFeaturePrimitive>;
}
