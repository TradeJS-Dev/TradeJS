export const RUNTIME_CONTROLS_SCHEMA = 'tradejs-runtime-controls/v1' as const;

export interface RuntimeStrategyPauseOverride {
  entriesPaused: true;
  updatedAt: string;
  updatedBy: string;
}

export interface RuntimeControls {
  schema: typeof RUNTIME_CONTROLS_SCHEMA;
  deployments: Record<string, Record<string, RuntimeStrategyPauseOverride>>;
}

export type RuntimeStrategyControlState = 'active' | 'entries_paused';

export type RuntimeStrategyControlEventAction = 'pause_entries' | 'resume';

export interface RuntimeStrategyControlEvent {
  eventId: string;
  deploymentId: string;
  strategyName: string;
  version: number;
  action: RuntimeStrategyControlEventAction;
  previousState: RuntimeStrategyControlState;
  nextState: RuntimeStrategyControlState;
  createdAt: number;
  createdBy: string;
}
