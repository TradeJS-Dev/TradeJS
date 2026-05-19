import ProgressBar from 'progress';
import { fork } from 'child_process';
import chalk from 'chalk';
import { randomUUID } from 'node:crypto';
import { TestSuite, TestWorkerResult } from '@tradejs/types';

type WorkerProgressMessage = {
  progress: true;
  testName: string;
  symbol: string;
  strategyName: string;
  stage: string;
  candleIndex?: number;
  candleTotal?: number;
  elapsedMs: number;
  stageElapsedMs: number;
};

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
  getProgressSnapshot: () => { symbol: string; profit: number };
}) => {
  const chunks = chunkTestSuite(testSuite);
  let completedTests = 0;
  let isFinishing = false;
  const workers = new Set<ReturnType<typeof fork>>();
  const activeProgressByWorker = new Map<string, WorkerProgressMessage>();
  let lastProgressRenderAt = 0;

  const formatDurationSeconds = (ms: number | undefined) =>
    `${Math.max(0, Math.round((ms ?? 0) / 1000))}s`;

  const formatWorkerProgress = (message: WorkerProgressMessage) => {
    const candlePart =
      typeof message.candleIndex === 'number' &&
      typeof message.candleTotal === 'number' &&
      message.candleTotal > 0
        ? ` ${message.candleIndex}/${message.candleTotal}`
        : '';
    return `${chalk.cyan(message.strategyName)} ${chalk.yellow(message.symbol)} ${chalk.gray(message.stage)}${chalk.gray(candlePart)} ${chalk.gray(`stage=${formatDurationSeconds(message.stageElapsedMs)}`)} ${chalk.gray(`total=${formatDurationSeconds(message.elapsedMs)}`)}`;
  };

  const renderActiveProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressRenderAt < 4000) {
      return;
    }
    lastProgressRenderAt = now;
    if (activeProgressByWorker.size === 0) {
      return;
    }

    const messages = [...activeProgressByWorker.values()]
      .sort((left, right) => right.elapsedMs - left.elapsedMs)
      .slice(0, 3)
      .map(formatWorkerProgress);

    bar.interrupt(`active: ${messages.join(' | ')}`);
  };

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
    ':current/:total [:bar][:percent] :symbol :amount :eta(s)',
    {
      total: testSuite.length,
      width: 20,
    },
  );

  for (const chunk of chunks) {
    const chunkId = randomUUID().slice(-12);
    const workerKey = chunkId;
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
        activeProgressByWorker.set(workerKey, msg);
        renderActiveProgress();
        return;
      }

      if (msg.done) {
        activeProgressByWorker.delete(workerKey);
        workers.delete(tester);
        await maybeFinish();
        return;
      }

      activeProgressByWorker.delete(workerKey);
      completedTests++;
      onMessage(msg);

      if (
        completedTests % progressStep === 0 ||
        completedTests === testSuite.length
      ) {
        const { symbol, profit } = getProgressSnapshot();
        const amount = profit || 0;
        const amountStr = `${amount.toFixed(2)}$`;
        bar.tick(
          completedTests === testSuite.length
            ? completedTests % progressStep
            : progressStep,
          {
            symbol: chalk.yellow(symbol || '-'),
            amount: amount > 0 ? chalk.green(amountStr) : chalk.red(amountStr),
          },
        );
      }
    });

    tester.on('error', (err) => {
      activeProgressByWorker.delete(workerKey);
      workers.delete(tester);
      onWorkerError(err?.message ?? String(err));
    });

    tester.on('exit', (code) => {
      activeProgressByWorker.delete(workerKey);
      workers.delete(tester);
      if (code !== 0) {
        onWorkerError(`Worker exited with code ${code}`);
      }
      void maybeFinish();
    });

    tester.send({ chunk: chunkWithId, chunkId, userName });
  }
};
