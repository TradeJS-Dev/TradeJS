import type {
  StrategyConfig,
  StrategyDecision,
  StrategyHookAiContext,
  StrategyHookEntryContext,
  StrategyHookMlContext,
  StrategyHookPolicyContext,
  StrategyManifest,
  StrategyPolicyProfile,
} from '@tradejs/types';

type EntryDecision = Extract<StrategyDecision, { kind: 'entry' }>;

export const resolveEntryRuntimePolicy = ({
  decision,
  config,
  manifest,
  policyProfile,
}: {
  decision: EntryDecision;
  config: StrategyConfig;
  manifest?: StrategyManifest;
  policyProfile?: StrategyPolicyProfile;
}) => {
  const baseDefaults = manifest?.entryRuntimeDefaults;
  const profileDefaults = policyProfile?.entryRuntimeDefaults;
  const manifestDefaults =
    baseDefaults || profileDefaults
      ? {
          ...baseDefaults,
          ...profileDefaults,
          ...(baseDefaults?.ml || profileDefaults?.ml
            ? { ml: { ...baseDefaults?.ml, ...profileDefaults?.ml } }
            : {}),
          ...(baseDefaults?.ai || profileDefaults?.ai
            ? { ai: { ...baseDefaults?.ai, ...profileDefaults?.ai } }
            : {}),
        }
      : undefined;
  const adapterMl = (
    policyProfile?.mlAdapter ?? manifest?.mlAdapter
  )?.mapEntryRuntimeFromConfig?.(config);
  const adapterAi = (
    policyProfile?.aiAdapter ?? manifest?.aiAdapter
  )?.mapEntryRuntimeFromConfig?.(config);
  const ml =
    manifestDefaults?.ml || adapterMl || decision.runtime?.ml
      ? {
          ...manifestDefaults?.ml,
          ...adapterMl,
          ...decision.runtime?.ml,
        }
      : undefined;
  const ai =
    manifestDefaults?.ai || adapterAi || decision.runtime?.ai
      ? {
          ...manifestDefaults?.ai,
          ...adapterAi,
          ...decision.runtime?.ai,
        }
      : undefined;

  return {
    ...manifestDefaults,
    ...decision.runtime,
    ml,
    ai,
  };
};

const formatGateNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const normalized = Number(value.toFixed(6));
  return Number.isInteger(normalized) ? String(normalized) : String(normalized);
};

const isMlRuntimeGateEnabled = (params: {
  env: string;
  ml?: StrategyHookMlContext;
}) => {
  const { env, ml } = params;
  return (
    env !== 'BACKTEST' && ml?.config != null && ml.config.enabled !== false
  );
};

const isMlResultUnavailable = (params: {
  env: string;
  ml?: StrategyHookMlContext;
}) => {
  const { env, ml } = params;
  return isMlRuntimeGateEnabled({ env, ml }) && ml?.result == null;
};

export const shouldExecuteEntryDecision = ({
  makeOrdersEnabled,
  env,
  signal,
  ml,
  aiEnabled,
  quality,
  minAiQuality,
}: {
  makeOrdersEnabled: boolean;
  env: string;
  signal?: EntryDecision['signal'];
  ml?: StrategyHookMlContext;
  aiEnabled: boolean;
  quality?: number;
  minAiQuality: number;
}) => {
  if (!makeOrdersEnabled) {
    return false;
  }

  if (!signal || env === 'BACKTEST') {
    return true;
  }

  if (isMlResultUnavailable({ env, ml })) {
    return false;
  }

  if (isMlRuntimeGateEnabled({ env, ml }) && ml?.result?.passed === false) {
    return false;
  }

  if (!aiEnabled) {
    return true;
  }

  return Number.isFinite(quality) && (quality as number) >= minAiQuality;
};

export const getEntrySkipReason = ({
  makeOrdersEnabled,
  env,
  ml,
  aiEnabled,
  quality,
  minAiQuality,
}: {
  makeOrdersEnabled: boolean;
  env: string;
  ml?: StrategyHookMlContext;
  aiEnabled: boolean;
  quality?: number;
  minAiQuality: number;
}): string => {
  if (!makeOrdersEnabled) {
    return 'MAKE_ORDERS_DISABLED';
  }

  if (isMlResultUnavailable({ env, ml })) {
    return 'ML_RESULT_UNAVAILABLE';
  }

  if (isMlRuntimeGateEnabled({ env, ml }) && ml?.result?.passed === false) {
    const probability = formatGateNumber(ml.result.probability);
    const threshold = formatGateNumber(ml.result.threshold);
    return `ML_THRESHOLD_NOT_MET (${probability} < ${threshold})`;
  }

  if (env !== 'BACKTEST' && aiEnabled && quality == null) {
    return 'AI_QUALITY_UNAVAILABLE';
  }

  if (
    env !== 'BACKTEST' &&
    aiEnabled &&
    quality != null &&
    Number.isFinite(quality) &&
    quality < minAiQuality
  ) {
    return `AI_QUALITY_BELOW_MIN (${quality} < ${minAiQuality})`;
  }

  return 'ENTRY_POLICY_BLOCKED';
};

export const buildHookEntry = ({
  decision,
  runtime,
}: {
  decision: EntryDecision;
  runtime: ResolvedEntryRuntime;
}): StrategyHookEntryContext => ({
  context: decision.entryContext,
  orderPlan: decision.orderPlan,
  signal: decision.signal,
  runtime: {
    raw: decision.runtime,
    resolved: runtime,
  },
});

export const buildHookPolicy = ({
  quality,
  makeOrdersEnabled,
  minAiQuality,
}: {
  quality?: number;
  makeOrdersEnabled: boolean;
  minAiQuality: number;
}): StrategyHookPolicyContext => ({
  aiQuality: quality,
  makeOrdersEnabled,
  minAiQuality,
});

export const buildMlHookContext = ({
  signal,
  env,
  ml,
}: {
  signal: NonNullable<EntryDecision['signal']>;
  env: string;
  ml: ResolvedEntryRuntime['ml'];
}): StrategyHookMlContext => {
  if (env === 'BACKTEST') {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'BACKTEST',
    };
  }

  if (!ml) {
    return {
      attempted: false,
      applied: false,
      skippedReason: 'NO_RUNTIME',
    };
  }

  if (ml.enabled === false) {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'DISABLED',
    };
  }

  if (!ml.strategyConfig) {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'NO_STRATEGY_CONFIG',
    };
  }

  if (typeof ml.mlThreshold !== 'number') {
    return {
      config: ml,
      attempted: false,
      applied: false,
      skippedReason: 'NO_THRESHOLD',
    };
  }

  if (signal.ml) {
    return {
      config: ml,
      attempted: true,
      applied: true,
      result: signal.ml,
    };
  }

  return {
    config: ml,
    attempted: true,
    applied: false,
    skippedReason: 'NO_RESULT',
  };
};

export const buildAiHookContext = ({
  env,
  ai,
  quality,
}: {
  env: string;
  ai: ResolvedEntryRuntime['ai'];
  quality?: number;
}): StrategyHookAiContext => {
  if (env === 'BACKTEST') {
    return {
      config: ai,
      attempted: false,
      applied: false,
      skippedReason: 'BACKTEST',
    };
  }

  if (!ai) {
    return {
      attempted: false,
      applied: false,
      skippedReason: 'NO_RUNTIME',
    };
  }

  if (ai.enabled === false) {
    return {
      config: ai,
      attempted: false,
      applied: false,
      skippedReason: 'DISABLED',
    };
  }

  if (typeof quality === 'number') {
    return {
      config: ai,
      attempted: true,
      applied: true,
      quality,
    };
  }

  return {
    config: ai,
    attempted: true,
    applied: false,
    skippedReason: 'NO_QUALITY',
  };
};

export type ResolvedEntryRuntime = ReturnType<typeof resolveEntryRuntimePolicy>;
