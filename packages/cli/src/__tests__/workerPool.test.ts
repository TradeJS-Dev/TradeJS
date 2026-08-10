const loadWorkerPool = async () => {
  jest.resetModules();

  const progressTick = jest.fn();
  const progressBar = jest.fn(() => ({
    tick: progressTick,
  }));
  const forkedWorkers: any[] = [];

  jest.doMock('progress', () => ({
    __esModule: true,
    default: progressBar,
  }));

  jest.doMock('child_process', () => ({
    fork: jest.fn(() => {
      const { EventEmitter } = require('events');
      const worker = new EventEmitter();
      worker.killed = false;
      worker.kill = jest.fn();
      worker.send = jest.fn();
      forkedWorkers.push(worker);
      return worker;
    }),
  }));

  const module = await import('../lib/backtest/workerPool');
  return {
    executeBacktestWorkerPool: module.executeBacktestWorkerPool,
    resolveFastAiWorkerPgPoolMax: module.resolveFastAiWorkerPgPoolMax,
    forkedWorkers,
    progressBar,
    progressTick,
  };
};

describe('executeBacktestWorkerPool', () => {
  it.each([
    { workerCount: 2, expected: '9' },
    { workerCount: 3, expected: '6' },
    { workerCount: 4, expected: '4' },
    { workerCount: 5, expected: '3' },
    { workerCount: 6, expected: '3' },
  ])(
    'caps fast AI worker pools at $expected connections for $workerCount workers',
    async ({ workerCount, expected }) => {
      const { resolveFastAiWorkerPgPoolMax } = await loadWorkerPool();

      expect(
        resolveFastAiWorkerPgPoolMax(
          [{ fast: true, ai: true }] as any,
          workerCount,
          undefined,
        ),
      ).toBe(expected);
    },
  );

  it('does not cap single-worker, non-fast-AI, or explicitly configured pools', async () => {
    const { resolveFastAiWorkerPgPoolMax } = await loadWorkerPool();
    const fastAiSuite = [{ fast: true, ai: true }] as any;

    expect(
      resolveFastAiWorkerPgPoolMax(fastAiSuite, 1, undefined),
    ).toBeUndefined();
    expect(
      resolveFastAiWorkerPgPoolMax(
        [{ fast: true, ai: false }] as any,
        6,
        undefined,
      ),
    ).toBeUndefined();
    expect(resolveFastAiWorkerPgPoolMax(fastAiSuite, 6, '7')).toBeUndefined();
  });

  it('prints cumulative trades in backtest progress ticks', async () => {
    const {
      executeBacktestWorkerPool,
      forkedWorkers,
      progressBar,
      progressTick,
    } = await loadWorkerPool();
    const onFinish = jest.fn(async () => undefined);

    await executeBacktestWorkerPool({
      testSuite: [{ name: 'BTCUSDT__1' }, { name: 'ETHUSDT__1' }] as any,
      userName: 'root',
      progressStep: 1,
      workerHeapMb: 512,
      testerWorkerPath: '/repo/worker.js',
      testerNeedsTsRuntime: false,
      onMessage: jest.fn(),
      onWorkerError: jest.fn(),
      onFinish,
      introLines: [],
      chunkTestSuite: (testSuite) => [testSuite as any],
      getProgressSnapshot: () => ({
        averageProfit: 12.34,
        tradesCount: 7,
        winRate: 55.5,
      }),
    });

    expect(progressBar).toHaveBeenCalledWith(
      ':current/:total [:bar][:percent] avg :amount win :winRate trades :trades :eta(s)',
      expect.objectContaining({ total: 2 }),
    );

    const worker = forkedWorkers[0];
    worker.emit('message', { id: '1' });
    await Promise.resolve();
    worker.emit('message', { id: '2' });
    await Promise.resolve();
    worker.emit('message', { done: true });
    await Promise.resolve();

    expect(progressTick).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        trades: expect.stringContaining('7'),
        winRate: expect.stringContaining('55.5%'),
      }),
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('starts progress from restored completed tests on continued runs', async () => {
    const {
      executeBacktestWorkerPool,
      forkedWorkers,
      progressBar,
      progressTick,
    } = await loadWorkerPool();
    const onFinish = jest.fn(async () => undefined);

    await executeBacktestWorkerPool({
      testSuite: [{ name: 'SOLUSDT__1' }] as any,
      userName: 'root',
      progressStep: 1,
      workerHeapMb: 512,
      testerWorkerPath: '/repo/worker.js',
      testerNeedsTsRuntime: false,
      initialCompletedTests: 2,
      totalTests: 3,
      onMessage: jest.fn(),
      onWorkerError: jest.fn(),
      onFinish,
      introLines: [],
      chunkTestSuite: (testSuite) => [testSuite as any],
      getProgressSnapshot: () => ({
        averageProfit: -1.23,
        tradesCount: 11,
        winRate: 42,
      }),
    });

    expect(progressBar).toHaveBeenCalledWith(
      ':current/:total [:bar][:percent] avg :amount win :winRate trades :trades :eta(s)',
      expect.objectContaining({ total: 3 }),
    );
    expect(progressTick).toHaveBeenNthCalledWith(
      1,
      2,
      expect.objectContaining({
        trades: expect.stringContaining('11'),
        winRate: expect.stringContaining('42.0%'),
      }),
    );

    const worker = forkedWorkers[0];
    worker.emit('message', { id: '3' });
    await Promise.resolve();
    worker.emit('message', { done: true });
    await Promise.resolve();

    expect(progressTick).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        trades: expect.stringContaining('11'),
        winRate: expect.stringContaining('42.0%'),
      }),
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('prefixes worker chunk ids with backtest run id for dataset attempts', async () => {
    const { executeBacktestWorkerPool, forkedWorkers } = await loadWorkerPool();

    await executeBacktestWorkerPool({
      testSuite: [
        {
          name: 'SOLUSDT__1',
          backtestRunId: '202606201200-aaaaaaaa',
        },
      ] as any,
      userName: 'root',
      progressStep: 1,
      workerHeapMb: 512,
      testerWorkerPath: '/repo/worker.js',
      testerNeedsTsRuntime: false,
      onMessage: jest.fn(),
      onWorkerError: jest.fn(),
      onFinish: jest.fn(async () => undefined),
      introLines: [],
      chunkTestSuite: (testSuite) => [testSuite as any],
      getProgressSnapshot: () => ({
        averageProfit: 0,
        tradesCount: 0,
        winRate: 0,
      }),
    });

    const worker = forkedWorkers[0];
    expect(worker.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: expect.stringMatching(/^202606201200-aaaaaaaa-[a-f0-9]+$/),
        chunk: [
          expect.objectContaining({
            chunkId: expect.stringMatching(/^202606201200-aaaaaaaa-[a-f0-9]+$/),
          }),
        ],
      }),
    );

    worker.emit('message', { id: '1' });
    await Promise.resolve();
    worker.emit('message', { done: true });
    await Promise.resolve();
  });

  it('removes interrupt handlers after worker pool finishes', async () => {
    const { executeBacktestWorkerPool, forkedWorkers } = await loadWorkerPool();
    const sigintListenersBefore = process.listenerCount('SIGINT');
    const sigtermListenersBefore = process.listenerCount('SIGTERM');

    await executeBacktestWorkerPool({
      testSuite: [{ name: 'BTCUSDT__1' }] as any,
      userName: 'root',
      progressStep: 1,
      workerHeapMb: 512,
      testerWorkerPath: '/repo/worker.js',
      testerNeedsTsRuntime: false,
      onMessage: jest.fn(),
      onWorkerError: jest.fn(),
      onFinish: jest.fn(async () => undefined),
      introLines: [],
      chunkTestSuite: (testSuite) => [testSuite as any],
      getProgressSnapshot: () => ({
        averageProfit: 0,
        tradesCount: 0,
        winRate: 0,
      }),
    });

    const worker = forkedWorkers[0];
    worker.emit('message', { id: '1' });
    await Promise.resolve();
    worker.emit('message', { done: true });
    await Promise.resolve();

    expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
  });
});
