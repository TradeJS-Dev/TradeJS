import type { RuntimeSignalEvaluationRecord } from '@tradejs/types';
import {
  incrHashFields,
  redisKeys,
  setHashJsonField,
} from '@tradejs/infra/redis';
import {
  buildRuntimeSignalStatsIncrements,
  getRuntimeSignalRetentionTtlSeconds,
  getRuntimeStorageDayKey,
  shouldStoreDetailedRuntimeSignalEvaluation,
} from '../runtimeSignalsStorage';

export const buildRuntimeSignalEvaluationId = ({
  strategyName,
  symbol,
  timestamp,
}: {
  strategyName: string;
  symbol: string;
  timestamp: number;
}) => `${strategyName}:${symbol}:${timestamp}`;

export const saveRuntimeSignalEvaluation = async (
  evaluation: RuntimeSignalEvaluationRecord,
) => {
  const dayKey = getRuntimeStorageDayKey(evaluation.timestamp);
  const runtimeSignalRetentionTtl = getRuntimeSignalRetentionTtlSeconds();
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
