import {
  canRunTestsInSharedCandleLoop,
  releaseTestingSymbolCache,
  resetTestingKlineCache,
  testing,
  testingGroupInSharedCandleLoop,
} from '../testing';
import { calculateStatsFull } from '@tradejs/core/backtest';
import { writeCachedBacktestArtifacts } from '@tradejs/infra/backtestArtifacts';
import { TestSuite } from '@tradejs/types';
import { closeAllAiDatasetWriters } from '@tradejs/infra/ai';
import { closeAllMlDatasetWriters } from '@tradejs/infra/ml';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { logger } from '@tradejs/infra/logger';
import { configureTimescaleMarketContextSchemaMode } from '@tradejs/infra/timescale/client';

let isProcessing = false;

// The parent process owns schema migrations/backfills before workers are forked.
configureTimescaleMarketContextSchemaMode('verify');

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

  await writeCachedBacktestArtifacts({
    userName,
    orderLogId,
    orderLog: inlineOrderLog,
    positionLog: inlinePositionLog,
  });
};

const buildResultStat = (testResult: Awaited<ReturnType<typeof testing>>) => {
  if (!testResult) {
    return testResult;
  }

  const { inlinePositionLog, stat } = testResult;
  if (!Array.isArray(inlinePositionLog) || inlinePositionLog.length === 0) {
    return stat;
  }

  return calculateStatsFull(inlinePositionLog) ?? stat;
};

const sendTestResult = async ({
  userName,
  test,
  testResult,
}: {
  userName: string;
  test: TestSuite[number];
  testResult: NonNullable<Awaited<ReturnType<typeof testing>>>;
}) => {
  await cacheTestResultArtifacts(userName, testResult);

  const stat = buildResultStat(testResult);
  const {
    inlineOrderLog,
    inlinePositionLog,
    inlineReplaySignalEvaluations,
    stat: _rawStat,
    ...resultWithoutLogs
  } = testResult;

  process.send?.({
    ...resultWithoutLogs,
    stat,
    test,
  });
};

const collectSharedLoopGroup = (testSuite: TestSuite, startIndex: number) => {
  const group = [testSuite[startIndex]];
  for (let index = startIndex + 1; index < testSuite.length; index += 1) {
    const nextGroup = [...group, testSuite[index]];
    if (!canRunTestsInSharedCandleLoop(nextGroup)) {
      break;
    }
    group.push(testSuite[index]);
  }
  return group;
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

      for (let index = 0; index < testSuite.length; ) {
        const test = testSuite[index];
        const group = collectSharedLoopGroup(testSuite, index);
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

        let completedTest = group[group.length - 1] ?? test;
        try {
          if (group.length > 1) {
            const groupResults = await testingGroupInSharedCandleLoop(group);
            for (const { test: groupTest, result } of groupResults) {
              await sendTestResult({
                userName,
                test: groupTest,
                testResult: result,
              });
            }
            index += group.length;
            continue;
          }

          const testResult = await testing(test);

          if (!testResult) {
            throw new Error('No result');
          }

          await sendTestResult({
            userName,
            test,
            testResult,
          });
          index += 1;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('tester worker error: %s', errorMessage);
          for (const failedTest of group) {
            process.send?.({
              error: true,
              id: failedTest.name,
              symbol: failedTest.symbol,
              msg: {
                message: errorMessage,
                stack: errorStack,
              },
            });
          }
          index += group.length;
        } finally {
          previousTest = completedTest;
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
