import ProgressBar from 'progress';
import { fork } from 'child_process';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { TestSuite, TestWorkerResult } from '@tradejs/types';

export const executeBacktestWorkerPool = async ({
  testSuite,
  userName,
  progressStep,
  workerHeapMb,
  testerWorkerPath,
  testerNeedsTsRuntime,
  onMessage,
  onWorkerError,
  onFinish,
  introLines,
  chunkTestSuite,
  getProgressSnapshot,
}: {
  testSuite: TestSuite;
  userName: string;
  progressStep: number;
  workerHeapMb: number;
  testerWorkerPath: string;
  testerNeedsTsRuntime: boolean;
  onMessage: (msg: any) => void;
  onWorkerError: (message: string) => void;
  onFinish: () => Promise<void>;
  introLines: string[];
  chunkTestSuite: (testSuite: TestSuite) => TestSuite[];
  getProgressSnapshot: () => { averageProfit: number; winRate: number };
}) => {
  const chunks = chunkTestSuite(testSuite);
  let completedTests = 0;
  let renderedTests = 0;
  let isFinishing = false;
  const workers = new Set<ReturnType<typeof fork>>();

  const maybeFinish = async () => {
    if (isFinishing) {
      return;
    }

    if (completedTests !== testSuite.length || workers.size > 0) {
      return;
    }

    isFinishing = true;
    await onFinish();
  };

  const stopWorkers = () => {
    for (const worker of workers) {
      if (!worker.killed) {
        worker.kill('SIGTERM');
      }
    }
  };

  process.once('SIGINT', () => {
    stopWorkers();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stopWorkers();
    process.exit(143);
  });

  for (const line of introLines) {
    console.log(line);
  }
  console.log('');

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] avg :amount win :winRate :eta(s)',
    {
      total: testSuite.length,
      width: 20,
    },
  );

  for (const chunk of chunks) {
    const chunkId = randomUUID().slice(-12);
    const chunkWithId = chunk.map((test) => ({ ...test, chunkId }));
    const tester = fork(testerWorkerPath, [], {
      execArgv: testerNeedsTsRuntime
        ? [
            `--max-old-space-size=${workerHeapMb}`,
            '-r',
            'ts-node/register',
            '-r',
            'tsconfig-paths/register',
          ]
        : [`--max-old-space-size=${workerHeapMb}`],
    });
    workers.add(tester);

    tester.on('message', async (msg: any) => {
      if (msg?.progress) {
        return;
      }

      if (msg.done) {
        workers.delete(tester);
        await maybeFinish();
        return;
      }

      completedTests++;
      onMessage(msg);

      if (
        completedTests % progressStep === 0 ||
        completedTests === testSuite.length
      ) {
        const { averageProfit, winRate } = getProgressSnapshot();
        const amount = averageProfit || 0;
        const amountStr = `${amount.toFixed(2)}$`;
        const progressIncrement = completedTests - renderedTests;
        if (progressIncrement > 0) {
          bar.tick(progressIncrement, {
            amount: amount > 0 ? chalk.green(amountStr) : chalk.red(amountStr),
            winRate: chalk.cyan(`${winRate.toFixed(1)}%`),
          });
          renderedTests = completedTests;
        }
      }
    });

    tester.on('error', (err) => {
      workers.delete(tester);
      onWorkerError(err?.message ?? String(err));
    });

    tester.on('exit', (code) => {
      workers.delete(tester);
      if (code !== 0) {
        onWorkerError(`Worker exited with code ${code}`);
      }
      void maybeFinish();
    });

    tester.send({ chunk: chunkWithId, chunkId, userName });
  }
};
