import { RuntimeSignalEvaluationRecord, Signal } from '@tradejs/types';

const DAY_MS = 86_400_000;
const RUNTIME_STORAGE_DAY_OFFSET_MS = 5 * 60 * 60 * 1000;

export type RuntimeSignalBucketRef = Pick<
  Signal,
  'signalId' | 'symbol' | 'strategy' | 'timestamp'
>;

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

const toIsoDayKey = (timestamp: number) =>
  new Date(timestamp).toISOString().slice(0, 10);

const toRuntimeStorageDayTimestamp = (timestamp: number) =>
  Math.floor((timestamp + RUNTIME_STORAGE_DAY_OFFSET_MS) / DAY_MS) * DAY_MS;

// Runtime summary cron runs at 22:00 Europe/Moscow. Shift the logical
// bucket boundary so one stored "day" maps to exactly one summary window.
export const getRuntimeStorageDayKey = (timestamp: number) =>
  toIsoDayKey(toRuntimeStorageDayTimestamp(timestamp));

export const getRuntimeStorageDayKeys = (
  startTime: number,
  endTime: number,
): string[] => {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return [];
  }

  const start = Math.min(startTime, endTime);
  const endExclusive = Math.max(startTime, endTime);
  const normalizedEnd = Math.max(start, endExclusive - 1);
  const keys: string[] = [];
  const startDay = toRuntimeStorageDayTimestamp(start);
  const endDay = toRuntimeStorageDayTimestamp(normalizedEnd);

  for (let current = startDay; current <= endDay; current += DAY_MS) {
    keys.push(toIsoDayKey(current));
  }

  return keys;
};

export const toRuntimeSignalBucketRef = (
  signal: Signal,
): RuntimeSignalBucketRef => ({
  signalId: signal.signalId,
  symbol: signal.symbol,
  strategy: signal.strategy,
  timestamp: signal.timestamp,
});

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
