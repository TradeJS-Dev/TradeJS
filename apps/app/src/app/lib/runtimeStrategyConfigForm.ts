import type { StrategyConfig } from '@tradejs/types';

export type RuntimeStrategyManagedParameters = {
  maxLossValue: number;
  aiEnabled: boolean;
  aiMode: 'gate' | 'llm';
  minAiQuality: number;
  mlEnabled: boolean;
  mlThreshold: number;
};

export const DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS: RuntimeStrategyManagedParameters =
  {
    maxLossValue: 1,
    aiEnabled: true,
    aiMode: 'gate',
    minAiQuality: 4,
    mlEnabled: false,
    mlThreshold: 0.1,
  };

const FORM_FIELDS = new Set([
  'ENABLE',
  'INTERVAL',
  'UNIVERSE',
  'ACCOUNT_ID',
  'MAX_LOSS_VALUE',
  'AI_ENABLED',
  'AI_MODE',
  'MIN_AI_QUALITY',
  'ML_ENABLED',
  'ML_THRESHOLD',
]);

const readNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (value: unknown, fallback: boolean) =>
  typeof value === 'boolean' ? value : fallback;

export const splitRuntimeStrategyConfig = (config: StrategyConfig | null) => ({
  managed: {
    maxLossValue: readNumber(
      config?.MAX_LOSS_VALUE,
      DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS.maxLossValue,
    ),
    aiEnabled: readBoolean(
      config?.AI_ENABLED,
      DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS.aiEnabled,
    ),
    aiMode:
      config?.AI_MODE === 'llm' || config?.AI_MODE === 'gate'
        ? config.AI_MODE
        : DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS.aiMode,
    minAiQuality: readNumber(
      config?.MIN_AI_QUALITY,
      DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS.minAiQuality,
    ),
    mlEnabled: readBoolean(
      config?.ML_ENABLED,
      DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS.mlEnabled,
    ),
    mlThreshold: readNumber(
      config?.ML_THRESHOLD,
      DEFAULT_RUNTIME_STRATEGY_MANAGED_PARAMETERS.mlThreshold,
    ),
  } satisfies RuntimeStrategyManagedParameters,
  parameters: Object.fromEntries(
    Object.entries(config ?? {}).filter(([key]) => !FORM_FIELDS.has(key)),
  ),
});

export const mergeRuntimeStrategyManagedParameters = (
  parameters: Record<string, unknown>,
  managed: RuntimeStrategyManagedParameters,
) => ({
  ...parameters,
  MAX_LOSS_VALUE: managed.maxLossValue,
  AI_ENABLED: managed.aiEnabled,
  AI_MODE: managed.aiMode,
  MIN_AI_QUALITY: managed.minAiQuality,
  ML_ENABLED: managed.mlEnabled,
  ML_THRESHOLD: managed.mlThreshold,
});
