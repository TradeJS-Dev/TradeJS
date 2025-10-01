import { testing } from '@utils/testing';
import { TestSuite } from '@types';
import { getData } from '@utils/data';

process.on('message', async ({ chunkId }: { chunkId: string }) => {
  const testSuite = (await getData('data/cache', chunkId)) as TestSuite;

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
      console.error(error);
      process.send?.({ error: true, id: test.name });
    }
  }

  process.send?.({ done: true });
});
