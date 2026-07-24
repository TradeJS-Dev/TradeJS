import type { RuntimeSignalEvaluationRecord } from '@tradejs/types';
import {
  getHashJsonField,
  incrHashFields,
  redisKeys,
  setHashJsonField,
} from '@tradejs/infra/redis';
import {
  buildRuntimeSignalStatsIncrements,
  getRuntimeSignalRetentionTtlSeconds,
  getRuntimeStorageDayKey,
  RuntimeLineageScopeRecord,
  RUNTIME_LINEAGE_SCOPE_RETENTION_TTL_SECONDS,
  shouldStoreDetailedRuntimeSignalEvaluation,
} from '../runtimeSignalsStorage';
import { runtimeLineageKey } from '../runtimeLineage';

const runtimeLineageScopeCache = new Map<string, RuntimeLineageScopeRecord>();
let runtimeLineageScopeCacheDayKey = '';

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

export const saveRuntimeSignalEvaluation = async (
  evaluation: RuntimeSignalEvaluationRecord,
) => {
  const dayKey = getRuntimeStorageDayKey(evaluation.timestamp);
  if (runtimeLineageScopeCacheDayKey !== dayKey) {
    runtimeLineageScopeCache.clear();
    runtimeLineageScopeCacheDayKey = dayKey;
  }
  const runtimeSignalRetentionTtl = getRuntimeSignalRetentionTtlSeconds();
  if (evaluation.runtimeLineage) {
    const lineageField = [
      evaluation.strategy,
      evaluation.runtimeConfigId ?? 'config',
      evaluation.symbol,
      runtimeLineageKey(evaluation.runtimeLineage),
    ].join(':');
    const lineageBucket = redisKeys.runtimeLineageScopeBucket(
      evaluation.userName,
      dayKey,
    );
    const cacheKey = `${lineageBucket}:${lineageField}`;
    const existing =
      runtimeLineageScopeCache.get(cacheKey) ??
      (await getHashJsonField<RuntimeLineageScopeRecord>(
        lineageBucket,
        lineageField,
      ));
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
    await setHashJsonField(lineageBucket, lineageField, scope, {
      expire: RUNTIME_LINEAGE_SCOPE_RETENTION_TTL_SECONDS,
    });
  }
  if (shouldStoreDetailedRuntimeSignalEvaluation(evaluation)) {
    await setHashJsonField(
      redisKeys.runtimeSignalEvaluationBucket(
        evaluation.userName,
        dayKey,
        evaluation.strategy,
      ),
      evaluation.evaluationId,
      evaluation,
      {
        expire: runtimeSignalRetentionTtl,
      },
    );
  }
  await incrHashFields(
    redisKeys.runtimeSignalEvaluationStatsBucket(
      evaluation.userName,
      dayKey,
      evaluation.strategy,
    ),
    buildRuntimeSignalStatsIncrements(evaluation),
    {
      expire: runtimeSignalRetentionTtl,
    },
  );
};
