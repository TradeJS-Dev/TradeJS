import type { RuntimeSignalEvaluationRecord, Signal } from '@tradejs/types';
import {
  getHashJsonValues,
  incrHashFields,
  redisKeys,
  setData,
  setHashJsonFields,
} from '@tradejs/infra/redis';
import {
  buildRuntimeSignalStatsIncrements,
  getRuntimeSignalRetentionTtlSeconds,
  getRuntimeStorageDayKey,
  RuntimeLineageScopeRecord,
  RUNTIME_LINEAGE_SCOPE_RETENTION_TTL_SECONDS,
  shouldStoreDetailedRuntimeSignalEvaluation,
  toRuntimeSignalBucketRef,
  toStoredRuntimeSignal,
} from '../runtimeSignalsStorage';
import { runtimeLineageKey } from '../runtimeLineage';

const runtimeLineageScopeCache = new Map<string, RuntimeLineageScopeRecord>();
let runtimeLineageScopeCacheDayKey = '';
let runtimeLineageScopeCacheLoaded = false;

export const buildRuntimeSignalEvaluationId = ({
  strategyName,
  symbol,
  timestamp,
  runtimeConfigId,
}: {
  strategyName: string;
  symbol: string;
  timestamp: number;
  runtimeConfigId?: string;
}) =>
  runtimeConfigId && runtimeConfigId !== 'config'
    ? [strategyName, runtimeConfigId, symbol, timestamp].join(':')
    : [strategyName, symbol, timestamp].join(':');

const buildLineageField = (scope: {
  strategy: string;
  runtimeConfigId?: string;
  symbol: string;
  lineage: NonNullable<RuntimeSignalEvaluationRecord['runtimeLineage']>;
}) =>
  [
    scope.strategy,
    scope.runtimeConfigId ?? 'config',
    scope.symbol,
    runtimeLineageKey(scope.lineage),
  ].join(':');

export const flushRuntimeSignalEvaluations = async (
  evaluations: readonly RuntimeSignalEvaluationRecord[],
) => {
  if (evaluations.length === 0) return;

  const evaluationsByDay = new Map<string, RuntimeSignalEvaluationRecord[]>();
  for (const evaluation of evaluations) {
    const dayKey = getRuntimeStorageDayKey(evaluation.timestamp);
    const dayEvaluations = evaluationsByDay.get(dayKey) ?? [];
    dayEvaluations.push(evaluation);
    evaluationsByDay.set(dayKey, dayEvaluations);
  }

  const runtimeSignalRetentionTtl = getRuntimeSignalRetentionTtlSeconds();

  for (const [dayKey, dayEvaluations] of evaluationsByDay) {
    if (runtimeLineageScopeCacheDayKey !== dayKey) {
      runtimeLineageScopeCache.clear();
      runtimeLineageScopeCacheDayKey = dayKey;
      runtimeLineageScopeCacheLoaded = false;
    }
    const lineageBucket = redisKeys.runtimeLineageScopeBucket(
      dayEvaluations[0].userName,
      dayKey,
    );
    const lineageEvaluations = dayEvaluations.filter(
      (
        evaluation,
      ): evaluation is RuntimeSignalEvaluationRecord & {
        runtimeLineage: NonNullable<
          RuntimeSignalEvaluationRecord['runtimeLineage']
        >;
      } => evaluation.runtimeLineage != null,
    );
    if (lineageEvaluations.length > 0 && !runtimeLineageScopeCacheLoaded) {
      const storedScopes =
        await getHashJsonValues<RuntimeLineageScopeRecord>(lineageBucket);
      for (const scope of storedScopes) {
        const lineageField = buildLineageField(scope);
        runtimeLineageScopeCache.set(`${lineageBucket}:${lineageField}`, scope);
      }
      runtimeLineageScopeCacheLoaded = true;
    }

    const lineageWrites = new Map<string, RuntimeLineageScopeRecord>();
    for (const evaluation of lineageEvaluations) {
      const lineageField = buildLineageField({
        strategy: evaluation.strategy,
        runtimeConfigId: evaluation.runtimeConfigId,
        symbol: evaluation.symbol,
        lineage: evaluation.runtimeLineage,
      });
      const cacheKey = `${lineageBucket}:${lineageField}`;
      const existing = runtimeLineageScopeCache.get(cacheKey);
      const scope: RuntimeLineageScopeRecord = {
        strategy: evaluation.strategy,
        symbol: evaluation.symbol,
        runtimeConfigId: evaluation.runtimeConfigId,
        lineage: evaluation.runtimeLineage,
        firstTimestamp: Math.min(
          existing?.firstTimestamp ?? evaluation.timestamp,
          evaluation.timestamp,
        ),
        lastTimestamp: Math.max(
          existing?.lastTimestamp ?? evaluation.timestamp,
          evaluation.timestamp,
        ),
      };
      runtimeLineageScopeCache.set(cacheKey, scope);
      lineageWrites.set(lineageField, scope);
    }
    if (lineageWrites.size > 0) {
      await setHashJsonFields(
        lineageBucket,
        [...lineageWrites].map(([field, data]) => ({ field, data })),
        {
          expire: RUNTIME_LINEAGE_SCOPE_RETENTION_TTL_SECONDS,
        },
      );
    }

    const detailedWrites = new Map<
      string,
      Array<{ field: string; data: RuntimeSignalEvaluationRecord }>
    >();
    const statsIncrements = new Map<string, Record<string, number>>();
    for (const evaluation of dayEvaluations) {
      if (shouldStoreDetailedRuntimeSignalEvaluation(evaluation)) {
        const bucket = redisKeys.runtimeSignalEvaluationBucket(
          evaluation.userName,
          dayKey,
          evaluation.strategy,
        );
        const entries = detailedWrites.get(bucket) ?? [];
        entries.push({
          field: evaluation.evaluationId,
          data: evaluation,
        });
        detailedWrites.set(bucket, entries);
      }
      const statsBucket = redisKeys.runtimeSignalEvaluationStatsBucket(
        evaluation.userName,
        dayKey,
        evaluation.strategy,
      );
      const increments = statsIncrements.get(statsBucket) ?? {};
      for (const [field, increment] of Object.entries(
        buildRuntimeSignalStatsIncrements(evaluation),
      )) {
        increments[field] = (increments[field] ?? 0) + increment;
      }
      statsIncrements.set(statsBucket, increments);
    }

    await Promise.all([
      ...[...detailedWrites].map(([bucket, entries]) =>
        setHashJsonFields(bucket, entries, {
          expire: runtimeSignalRetentionTtl,
        }),
      ),
      ...[...statsIncrements].map(([bucket, increments]) =>
        incrHashFields(bucket, increments, {
          expire: runtimeSignalRetentionTtl,
        }),
      ),
    ]);
  }
};

export const createRuntimeSignalEvaluationBuffer = () => {
  const evaluations: RuntimeSignalEvaluationRecord[] = [];
  const signals: Array<{ userName: string; signal: Signal }> = [];
  return {
    save: async (evaluation: RuntimeSignalEvaluationRecord) => {
      evaluations.push(evaluation);
    },
    saveSignal: (userName: string, signal: Signal) => {
      signals.push({ userName, signal });
    },
    flush: async () => {
      const pending = evaluations.splice(0);
      const pendingSignals = signals.splice(0);
      const runtimeSignalRetentionTtl = getRuntimeSignalRetentionTtlSeconds();
      const signalRefsByBucket = new Map<
        string,
        Array<{
          field: string;
          data: ReturnType<typeof toRuntimeSignalBucketRef>;
        }>
      >();

      for (const { userName, signal } of pendingSignals) {
        const bucket = redisKeys.runtimeSignalBucket(
          userName,
          getRuntimeStorageDayKey(signal.timestamp),
          signal.strategy,
        );
        const entries = signalRefsByBucket.get(bucket) ?? [];
        entries.push({
          field: signal.signalId,
          data: toRuntimeSignalBucketRef(signal),
        });
        signalRefsByBucket.set(bucket, entries);
      }

      await Promise.all([
        flushRuntimeSignalEvaluations(pending),
        ...pendingSignals.map(({ signal }) =>
          setData(
            redisKeys.storeSignal(signal.symbol, signal.signalId),
            toStoredRuntimeSignal(signal),
            { expire: runtimeSignalRetentionTtl },
          ),
        ),
        ...[...signalRefsByBucket].map(([bucket, entries]) =>
          setHashJsonFields(bucket, entries, {
            expire: runtimeSignalRetentionTtl,
          }),
        ),
      ]);
    },
  };
};

export const saveRuntimeSignalEvaluation = async (
  evaluation: RuntimeSignalEvaluationRecord,
) => {
  await flushRuntimeSignalEvaluations([evaluation]);
};
