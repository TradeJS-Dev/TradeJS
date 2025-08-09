import { testing } from '@utils/testing';
import { TestSuite } from '@types';
import { getData } from '@utils/data';

process.on('message', async ({ chunkId }: { chunkId: string }) => {
  const testSuite = (await getData('data/cache', chunkId, {
    useCache: false,
  })) as TestSuite;

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
      process.send?.({ error, id: test.name });
    }
  }

  process.send?.({ done: true });
});
