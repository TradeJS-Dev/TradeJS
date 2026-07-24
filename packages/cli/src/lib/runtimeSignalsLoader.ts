import {
  getData,
  getHashData,
  getHashJsonValues,
  getKeys,
  redisKeys,
} from '@tradejs/infra/redis';
import { RuntimeSignalEvaluationRecord, Signal } from '@tradejs/types';
import {
  isRuntimeSignalBucketRef,
  getRuntimeStorageDayKeys,
  parseRuntimeSignalStatsBucket,
  RuntimeSignalStatsBucket,
  RuntimeLineageScopeRecord,
} from './runtimeSignalsStorage';

export const isSignalRecord = (value: unknown): value is Signal => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.signalId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.timestamp === 'number'
  );
};

export const isRuntimeSignalEvaluationRecord = (
  value: unknown,
): value is RuntimeSignalEvaluationRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.evaluationId === 'string' &&
    typeof record.strategy === 'string' &&
    typeof record.symbol === 'string' &&
    typeof record.timestamp === 'number' &&
    (record.status === 'signal' ||
      record.status === 'skip' ||
      record.status === 'error')
  );
};

const sortByTimestamp = <T extends { timestamp: number }>(records: T[]) =>
  [...records].sort((left, right) => left.timestamp - right.timestamp);

const filterBucketKeysByWindow = (
  bucketKeys: string[],
  prefix: string,
  startTime?: number,
  endTime?: number,
) => {
  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime == null ||
    endTime == null
  ) {
    return bucketKeys;
  }

  const allowedDayKeys = new Set(getRuntimeStorageDayKeys(startTime, endTime));
  if (!allowedDayKeys.size) {
    return [];
  }

  return bucketKeys.filter((key) => {
    const suffix = key.slice(prefix.length);
    const firstColon = suffix.indexOf(':');
    if (firstColon <= 0) {
      return false;
    }

    return allowedDayKeys.has(suffix.slice(0, firstColon));
  });
};

export const loadRuntimeSignals = async (
  userName: string,
  {
    startTime,
    endTime,
  }: {
    startTime?: number;
    endTime?: number;
  } = {},
): Promise<Signal[]> => {
  const bucketPrefix = redisKeys.runtimeSignalBuckets(userName);
  const bucketKeys = filterBucketKeysByWindow(
    await getKeys(bucketPrefix),
    bucketPrefix,
    startTime,
    endTime,
  );
  const refs = (
    await Promise.all(bucketKeys.map((key) => getHashJsonValues(key)))
  )
    .flat()
    .filter(isRuntimeSignalBucketRef);

  const seen = new Set<string>();
  const payloads = await Promise.all(
    refs.map(async (ref) => {
      const dedupeKey = `${ref.symbol}:${ref.signalId}`;
      if (seen.has(dedupeKey)) {
        return null;
      }
      seen.add(dedupeKey);

      const signal = await getData(
        redisKeys.storeSignal(ref.symbol, ref.signalId),
        null,
      );

      return isSignalRecord(signal) ? signal : null;
    }),
  );

  return sortByTimestamp(payloads.filter(isSignalRecord));
};

export const loadRuntimeSignalEvaluations = async (
  userName: string,
  {
    startTime,
    endTime,
  }: {
    startTime?: number;
    endTime?: number;
  } = {},
): Promise<RuntimeSignalEvaluationRecord[]> => {
  const bucketPrefix = redisKeys.runtimeSignalEvaluationBuckets(userName);
  const bucketKeys = filterBucketKeysByWindow(
    await getKeys(bucketPrefix),
    bucketPrefix,
    startTime,
    endTime,
  );
  const evaluations = (
    await Promise.all(bucketKeys.map((key) => getHashJsonValues(key)))
  )
    .flat()
    .filter(isRuntimeSignalEvaluationRecord);

  const deduped = new Map<string, RuntimeSignalEvaluationRecord>();
  for (const evaluation of evaluations) {
    deduped.set(evaluation.evaluationId, evaluation);
  }

  return sortByTimestamp([...deduped.values()]);
};

export const loadRuntimeLineageScopes = async (
  userName: string,
  {
    startTime,
    endTime,
  }: {
    startTime: number;
    endTime: number;
  },
): Promise<RuntimeLineageScopeRecord[]> => {
  const records = (
    await Promise.all(
      getRuntimeStorageDayKeys(startTime, endTime).map((dayKey) =>
        getHashJsonValues<RuntimeLineageScopeRecord>(
          redisKeys.runtimeLineageScopeBucket(userName, dayKey),
        ),
      ),
    )
  )
    .flat()
    .filter(
      (record) =>
        record != null &&
        typeof record.strategy === 'string' &&
        typeof record.symbol === 'string' &&
        typeof record.firstTimestamp === 'number' &&
        typeof record.lastTimestamp === 'number' &&
        record.lineage != null,
    );

  return records.sort(
    (left, right) =>
      left.firstTimestamp - right.firstTimestamp ||
      left.strategy.localeCompare(right.strategy) ||
      left.symbol.localeCompare(right.symbol),
  );
};

export type RuntimeSignalStatsBucketEntry = {
  key: string;
  dayKey: string;
  strategy: string;
  stats: RuntimeSignalStatsBucket;
};

const parseBucketKey = (prefix: string, key: string) => {
  if (!key.startsWith(prefix)) {
    return null;
  }

  const suffix = key.slice(prefix.length);
  const firstColon = suffix.indexOf(':');
  if (firstColon <= 0 || firstColon >= suffix.length - 1) {
    return null;
  }

  return {
    dayKey: suffix.slice(0, firstColon),
    strategy: suffix.slice(firstColon + 1),
  };
};

export const loadRuntimeSignalEvaluationStatsBuckets = async (
  userName: string,
): Promise<RuntimeSignalStatsBucketEntry[]> => {
  const prefix = redisKeys.runtimeSignalEvaluationStatsBuckets(userName);
  const keys = await getKeys(prefix);
  const entries = await Promise.all(
    keys.map(async (key) => {
      const parsedKey = parseBucketKey(prefix, key);
      if (!parsedKey) {
        return null;
      }

      return {
        key,
        ...parsedKey,
        stats: parseRuntimeSignalStatsBucket(await getHashData(key)),
      } satisfies RuntimeSignalStatsBucketEntry;
    }),
  );

  return entries.filter(Boolean) as RuntimeSignalStatsBucketEntry[];
};
