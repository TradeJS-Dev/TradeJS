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
    forkedWorkers,
    progressBar,
    progressTick,
  };
};

describe('executeBacktestWorkerPool', () => {
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
});
