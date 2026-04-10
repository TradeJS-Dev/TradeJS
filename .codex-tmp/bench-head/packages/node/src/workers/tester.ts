import { testing, resetTestingKlineCache } from '../testing';
import { TestSuite } from '@tradejs/types';
import { closeAllAiDatasetWriters } from '@tradejs/infra/ai';
import { closeAllMlDatasetWriters } from '@tradejs/infra/ml';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';

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
          logger.error(error);
          // TODO: Serialize error payload ({ message, stack }) before process.send for safer IPC transport.
          process.send?.({ error: true, id: test.name, msg: error });
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
