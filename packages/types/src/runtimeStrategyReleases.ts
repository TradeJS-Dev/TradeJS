import type { StrategyConfig } from './backtest';

export const RUNTIME_STRATEGY_RELEASE_SCHEMA =
  'tradejs-runtime-strategy-release/v2' as const;

export type RuntimeStrategyControlState = 'active' | 'entries_paused';

/**
 * An immutable strategy-owned runtime snapshot. Deployment/account bindings are
 * intentionally not part of this record.
 */
export interface RuntimeStrategyRelease {
  schema: typeof RUNTIME_STRATEGY_RELEASE_SCHEMA;
  strategyName: string;
  releaseVersion: number;
  config: StrategyConfig;
  strategyPackage: string;
  strategyPackageVersion: string;
  runtimePackageVersion: string;
  createdAt: number;
  createdBy: string;
  contentSha256: string;
}

export interface RuntimeStrategyReleaseRef {
  strategyName: string;
  releaseVersion: number;
  controlState: RuntimeStrategyControlState;
}

export type RuntimeStrategyControlEventAction = 'pause_entries' | 'resume';

export interface RuntimeStrategyControlEvent {
  eventId: string;
  deploymentId: string;
  strategyName: string;
  releaseVersion: number;
  action: RuntimeStrategyControlEventAction;
  previousState: RuntimeStrategyControlState;
  nextState: RuntimeStrategyControlState;
  createdAt: number;
  createdBy: string;
}
