import { TTL_10D } from '@tradejs/core/constants';
import type { RuntimeSignalEvaluationRecord } from '@tradejs/types';
import {
  incrHashFields,
  redisKeys,
  setHashJsonField,
} from '@tradejs/infra/redis';
import {
  buildRuntimeSignalStatsIncrements,
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
        expire: TTL_10D,
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
      expire: TTL_10D,
    },
  );
};
