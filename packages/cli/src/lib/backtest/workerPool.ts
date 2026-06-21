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
  onInterrupt,
  onWorkerError,
  onFinish,
  introLines,
  chunkTestSuite,
  getProgressSnapshot,
  initialCompletedTests = 0,
  totalTests,
}: {
  testSuite: TestSuite;
  userName: string;
  progressStep: number;
  workerHeapMb: number;
  testerWorkerPath: string;
  testerNeedsTsRuntime: boolean;
  onMessage: (msg: any) => Promise<void> | void;
  onInterrupt?: (signal: 'SIGINT' | 'SIGTERM') => Promise<void> | void;
  onWorkerError: (message: string) => void;
  onFinish: () => Promise<void>;
  introLines: string[];
  chunkTestSuite: (testSuite: TestSuite) => TestSuite[];
  getProgressSnapshot: () => {
    averageProfit: number;
    tradesCount: number;
    winRate: number;
  };
  initialCompletedTests?: number;
  totalTests?: number;
}) => {
  const chunks = chunkTestSuite(testSuite);
  const totalExpectedTests = Math.max(
    testSuite.length,
    totalTests ?? testSuite.length,
    initialCompletedTests,
  );
  let completedTests = initialCompletedTests;
  let renderedTests = 0;
  let isFinishing = false;
  let signalHandlersRemoved = false;
  const workers = new Set<ReturnType<typeof fork>>();

  const stopWorkers = () => {
    for (const worker of workers) {
      if (!worker.killed) {
        worker.kill('SIGTERM');
      }
    }
  };

  const handleInterrupt = (signal: 'SIGINT' | 'SIGTERM', exitCode: number) => {
    stopWorkers();
    void Promise.resolve(onInterrupt?.(signal))
      .catch((error) => {
        console.error(
          chalk.red(
            `failed to update backtest run status before ${signal}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      })
      .finally(() => process.exit(exitCode));
  };

  const handleSigint = () => handleInterrupt('SIGINT', 130);
  const handleSigterm = () => handleInterrupt('SIGTERM', 143);

  const cleanupSignalHandlers = () => {
    if (signalHandlersRemoved) {
      return;
    }

    signalHandlersRemoved = true;
    process.removeListener('SIGINT', handleSigint);
    process.removeListener('SIGTERM', handleSigterm);
  };

  const maybeFinish = async () => {
    if (isFinishing) {
      return;
    }

    if (completedTests !== totalExpectedTests || workers.size > 0) {
      return;
    }

    isFinishing = true;
    try {
      await onFinish();
    } finally {
      cleanupSignalHandlers();
    }
  };

  process.once('SIGINT', handleSigint);
  process.once('SIGTERM', handleSigterm);

  for (const line of introLines) {
    console.log(line);
  }
  console.log('');

  const bar = new ProgressBar(
    ':current/:total [:bar][:percent] avg :amount win :winRate trades :trades :eta(s)',
    {
      total: totalExpectedTests,
      width: 20,
    },
  );

  const tickProgress = () => {
    const { averageProfit, tradesCount, winRate } = getProgressSnapshot();
    const amount = averageProfit || 0;
    const amountStr = `${amount.toFixed(2)}$`;
    const progressIncrement = completedTests - renderedTests;
    if (progressIncrement > 0) {
      bar.tick(progressIncrement, {
        amount: amount > 0 ? chalk.green(amountStr) : chalk.red(amountStr),
        trades: chalk.cyan(String(tradesCount)),
        winRate: chalk.cyan(`${winRate.toFixed(1)}%`),
      });
      renderedTests = completedTests;
    }
  };

  tickProgress();

  for (const chunk of chunks) {
    const runId =
      typeof chunk[0]?.backtestRunId === 'string'
        ? chunk[0].backtestRunId.trim()
        : '';
    const attemptId = randomUUID().slice(-12);
    const chunkId = runId ? `${runId}-${attemptId}` : attemptId;
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
      await onMessage(msg);

      if (
        completedTests % progressStep === 0 ||
        completedTests === totalExpectedTests
      ) {
        tickProgress();
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
