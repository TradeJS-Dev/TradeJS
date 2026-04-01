import { resetTestingKlineCache, testing } from '@tradejs/node/backtest';
import { closeAllAiDatasetWriters } from '@tradejs/infra/ai';
import { logger } from '@tradejs/infra/logger';
import { closeAllMlDatasetWriters } from '@tradejs/infra/ml';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { TestSuite } from '@tradejs/types';

let isProcessing = false;

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

          const { stat, orderLogId } = testResult;
          process.send?.({
            stat,
            orderLogId,
            test,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('tester worker error: %s', errorMessage);
          process.send?.({
            error: true,
            id: test.name,
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

    process.send?.({ done: true });
    process.disconnect?.();
    process.exit(0);
  },
);
