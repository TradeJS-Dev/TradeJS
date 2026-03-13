import { testing, resetTestingKlineCache } from '@utils/testing';
import { TestSuite } from '@tradejs/types';
import { getData, redisKeys, closeAllMlDatasetWriters } from '@tradejs/infra';
import { logger } from '@tradejs/infra';

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
      await closeAllMlDatasetWriters();
      resetTestingKlineCache();
    }

    process.send?.({ done: true });
    process.disconnect?.();
    process.exit(0);
  },
);
