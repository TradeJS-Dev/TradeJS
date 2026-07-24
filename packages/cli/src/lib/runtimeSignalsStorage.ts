import { TTL_1M, TTL_3D } from '@tradejs/core/constants';
import {
  RuntimeLineage,
  RuntimeSignalEvaluationRecord,
  Signal,
} from '@tradejs/types';
import {
  getRuntimeStorageDayKey,
  getRuntimeStorageDayKeys,
} from '@tradejs/core/time';

export { getRuntimeStorageDayKey, getRuntimeStorageDayKeys };

export type RuntimeSignalBucketRef = Pick<
  Signal,
  'signalId' | 'symbol' | 'strategy' | 'timestamp' | 'runtimeConfigId'
>;

export type StoredRuntimeSignal = Omit<
  Signal,
  'figures' | 'indicators' | 'additionalIndicators'
> &
  Partial<Pick<Signal, 'figures' | 'indicators' | 'additionalIndicators'>>;

export type RuntimeSignalSkipSource =
  | 'core'
  | 'AI'
  | 'ML'
  | 'hook'
  | 'policy'
  | 'runtime';

export type RuntimeSignalStatsBucket = {
  evaluated: number;
  signals: number;
  reasonGroups: Map<string, Map<string, number>>;
};

export type RuntimeLineageScopeRecord = {
  strategy: string;
  symbol: string;
  runtimeConfigId?: string;
  lineage: RuntimeLineage;
  firstTimestamp: number;
  lastTimestamp: number;
};

const SECONDS_PER_DAY = 86_400;

export const RUNTIME_SIGNAL_RETENTION_DAYS_ENV =
  'RUNTIME_SIGNAL_RETENTION_DAYS';
export const DEFAULT_RUNTIME_SIGNAL_RETENTION_TTL_SECONDS = TTL_3D;
export const RUNTIME_LINEAGE_SCOPE_RETENTION_TTL_SECONDS = TTL_1M;

// Runtime summary cron runs at 21:00 Europe/Moscow. Shift the logical
// bucket boundary so one stored "day" maps to exactly one summary window.

const parsePositiveNumber = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getRuntimeSignalRetentionTtlSeconds = () => {
  const explicitDays = parsePositiveNumber(
    process.env[RUNTIME_SIGNAL_RETENTION_DAYS_ENV],
  );
  if (explicitDays != null) {
    return Math.ceil(explicitDays * SECONDS_PER_DAY);
  }

  return DEFAULT_RUNTIME_SIGNAL_RETENTION_TTL_SECONDS;
};

export const toRuntimeSignalBucketRef = (
  signal: Signal,
): RuntimeSignalBucketRef => ({
  signalId: signal.signalId,
  symbol: signal.symbol,
  strategy: signal.strategy,
  timestamp: signal.timestamp,
  ...(signal.runtimeConfigId && signal.runtimeConfigId !== 'config'
    ? { runtimeConfigId: signal.runtimeConfigId }
    : {}),
});

export const shouldStoreRuntimeSignalDiagnostics = (signal: Signal) =>
  signal.orderStatus === 'completed' || signal.orderStatus === 'failed';

export const toStoredRuntimeSignal = (signal: Signal): StoredRuntimeSignal => {
  if (shouldStoreRuntimeSignalDiagnostics(signal)) {
    return signal;
  }

  const stored: StoredRuntimeSignal = { ...signal };
  delete stored.figures;
  delete stored.indicators;
  delete stored.additionalIndicators;
  return stored;
};

export const isRuntimeSignalBucketRef = (
  value: unknown,
): value is RuntimeSignalBucketRef => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.signalId === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.timestamp === 'number'
  );
};

export const normalizeRuntimeSignalSkipReason = (
  reason: string,
  fallbackSource: RuntimeSignalSkipSource,
) => {
  let source = fallbackSource;
  let normalizedReason = reason;

  if (reason.startsWith('AI_QUALITY_BELOW_MIN')) {
    source = 'AI';
    normalizedReason = 'MIN_AI_QUALITY';
  } else if (reason === 'AI_QUALITY_UNAVAILABLE') {
    source = 'AI';
    normalizedReason = 'QUALITY_UNAVAILABLE';
  } else if (reason === 'ML_RESULT_UNAVAILABLE') {
    source = 'ML';
    normalizedReason = 'RESULT_UNAVAILABLE';
  } else if (reason.startsWith('ML_THRESHOLD_NOT_MET')) {
    source = 'ML';
    normalizedReason = 'ML_THRESHOLD';
  } else if (reason.startsWith('HOOK_BEFORE_ENTRY_GATE:')) {
    source = 'hook';
    normalizedReason = `BEFORE_ENTRY_GATE:${reason.slice(
      'HOOK_BEFORE_ENTRY_GATE:'.length,
    )}`;
  } else if (reason === 'HOOK_BEFORE_ENTRY_GATE') {
    source = 'hook';
    normalizedReason = 'BEFORE_ENTRY_GATE';
  } else if (
    reason === 'MAKE_ORDERS_DISABLED' ||
    reason === 'ENTRY_POLICY_BLOCKED'
  ) {
    source = 'policy';
  }

  return {
    source: `skip from ${source}`,
    reason: normalizedReason,
  };
};

const buildStatsReasonField = (source: string, reason: string) =>
  `reason:${source}:${reason}`;

export const buildRuntimeSignalStatsIncrements = (
  evaluation: RuntimeSignalEvaluationRecord,
): Record<string, number> => {
  const increments: Record<string, number> = {
    evaluated: 1,
  };

  if (evaluation.status === 'signal') {
    increments.signals = 1;
  }

  let skipReason: string | null = null;
  let fallbackSource: RuntimeSignalSkipSource = 'core';

  if (evaluation.status === 'skip') {
    skipReason = evaluation.reason || 'NO_SIGNAL';
    fallbackSource = 'core';
  } else if (
    evaluation.status === 'signal' &&
    (evaluation.orderStatus === 'skipped' ||
      evaluation.orderStatus === 'canceled')
  ) {
    skipReason =
      evaluation.orderSkipReason ||
      evaluation.reason ||
      `orderStatus=${evaluation.orderStatus}`;
    fallbackSource = 'runtime';
  } else if (evaluation.status === 'error') {
    skipReason = evaluation.reason || 'EVALUATION_ERROR';
    fallbackSource = 'runtime';
  }

  if (skipReason) {
    const normalized = normalizeRuntimeSignalSkipReason(
      skipReason,
      fallbackSource,
    );
    increments[buildStatsReasonField(normalized.source, normalized.reason)] = 1;
  }

  return increments;
};

export const shouldStoreDetailedRuntimeSignalEvaluation = (
  evaluation: RuntimeSignalEvaluationRecord,
) => evaluation.status !== 'skip';

const toCount = (value: string | undefined) => {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parseRuntimeSignalStatsBucket = (
  value: Record<string, string>,
): RuntimeSignalStatsBucket => {
  const reasonGroups = new Map<string, Map<string, number>>();

  for (const [field, rawCount] of Object.entries(value)) {
    if (!field.startsWith('reason:')) {
      continue;
    }

    const [, source, ...reasonParts] = field.split(':');
    const reason = reasonParts.join(':');
    if (!source || !reason) {
      continue;
    }

    const reasons = reasonGroups.get(source) ?? new Map<string, number>();
    reasons.set(reason, toCount(rawCount));
    reasonGroups.set(source, reasons);
  }

  return {
    evaluated: toCount(value.evaluated),
    signals: toCount(value.signals),
    reasonGroups,
  };
};
