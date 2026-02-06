import { testing } from '@utils/testing';
import { TestSuite } from '@types';
import { getData, redisKeys } from '@utils/redis';
import { logger } from '@utils/logger';

process.on(
  'message',
  async ({ chunkId, userName }: { chunkId: string; userName: string }) => {
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
        process.send?.({ error: true, id: test.name, msg: error });
      }
    }

    process.send?.({ done: true });
  },
);
