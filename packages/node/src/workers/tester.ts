import { testing, resetTestingKlineCache } from '../testing';
import { TestSuite } from '@tradejs/types';
import { closeAllAiDatasetWriters } from '@tradejs/infra/ai';
import { closeAllMlDatasetWriters } from '@tradejs/infra/ml';
import { TTL_1D } from '@tradejs/core/constants';
import { getData, redisKeys, setData } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';

let isProcessing = false;

const cacheTestResultArtifacts = async (
  userName: string,
  testResult: Awaited<ReturnType<typeof testing>>,
) => {
  if (!testResult) {
    return;
  }

  const { orderLogId, inlineOrderLog, inlinePositionLog } = testResult;
  if (!Array.isArray(inlineOrderLog) || !Array.isArray(inlinePositionLog)) {
    return;
  }

  await Promise.all([
    setData(redisKeys.cacheOrders(userName, orderLogId), inlineOrderLog, {
      expire: TTL_1D,
    }),
    setData(redisKeys.cachePositions(userName, orderLogId), inlinePositionLog, {
      expire: TTL_1D,
    }),
  ]);
};

process.on(
  'message',
  async ({ chunkId, userName }: { chunkId: string; userName: string }) => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      const testSuite = (await getData(
        redisKeys.cacheChunk(userName, chunkId),
      )) as TestSuite;

      for await (const test of testSuite) {
        try {
          const testResult = await testing(test);

          if (!testResult) {
            throw new Error('No result');
          }

          await cacheTestResultArtifacts(userName, testResult);

          const { inlineOrderLog, inlinePositionLog, ...resultWithoutLogs } =
            testResult;

          process.send?.({
            ...resultWithoutLogs,
            test,
          });
        } catch (error) {
          logger.error(error);
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          process.send?.({
            error: true,
            id: test.name,
            symbol: test.symbol,
            msg: {
              message: errorMessage,
              stack: errorStack,
            },
          });
        }
      }
    } finally {
      await closeAllAiDatasetWriters();
      await closeAllMlDatasetWriters();
      resetTestingKlineCache();
    }

    if (process.send) {
      process.send({ done: true }, () => {
        process.disconnect?.();
        process.exit(0);
      });
      return;
    }

    process.disconnect?.();
    process.exit(0);
  },
);
