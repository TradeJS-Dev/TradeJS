import {
  releaseTestingSymbolCache,
  resetTestingKlineCache,
  testing,
} from '@tradejs/node/backtest';
import { closeAllAiDatasetWriters } from '@tradejs/infra/ai';
import { logger } from '@tradejs/infra/logger';
import { closeAllMlDatasetWriters } from '@tradejs/infra/ml';
import { TTL_1D } from '@tradejs/core/constants';
import { getData, redisKeys, setData } from '@tradejs/infra/redis';
import { TestSuite } from '@tradejs/types';

let isProcessing = false;

const resolveTestSuite = async ({
  chunk,
  chunkId,
  userName,
}: {
  chunk?: TestSuite;
  chunkId?: string;
  userName: string;
}): Promise<TestSuite> => {
  if (Array.isArray(chunk)) {
    return chunk as TestSuite;
  }

  return (await getData(
    redisKeys.cacheChunk(userName, String(chunkId)),
  )) as TestSuite;
};

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
  async ({
    chunk,
    chunkId,
    userName,
  }: {
    chunk?: TestSuite;
    chunkId?: string;
    userName: string;
  }) => {
    if (isProcessing) {
      return;
    }
    isProcessing = true;

    try {
      const testSuite = await resolveTestSuite({
        chunk,
        chunkId,
        userName,
      });
      let previousTest: TestSuite[number] | null = null;

      for await (const test of testSuite) {
        if (
          previousTest &&
          (previousTest.symbol !== test.symbol ||
            previousTest.userName !== test.userName ||
            previousTest.connectorName !== test.connectorName)
        ) {
          releaseTestingSymbolCache({
            userName: previousTest.userName,
            connectorName: previousTest.connectorName,
            symbol: previousTest.symbol,
          });
        }

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
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('tester worker error: %s', errorMessage);
          process.send?.({
            error: true,
            id: test.name,
            symbol: test.symbol,
            msg: {
              message: errorMessage,
              stack: errorStack,
            },
          });
        } finally {
          previousTest = test;
        }
      }

      if (previousTest) {
        releaseTestingSymbolCache({
          userName: previousTest.userName,
          connectorName: previousTest.connectorName,
          symbol: previousTest.symbol,
        });
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
