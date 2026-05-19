const progressTick = jest.fn();
const progressInterrupt = jest.fn();
const workerHandlers = new Map<string, (message: any) => void>();

jest.mock('progress', () => {
  return jest.fn().mockImplementation(() => ({
    tick: progressTick,
    interrupt: progressInterrupt,
  }));
});

jest.mock('child_process', () => ({
  fork: jest.fn(() => {
    const handlers = new Map<string, (...args: any[]) => void>();
    return {
      killed: false,
      on: jest.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
      }),
      send: jest.fn((message: any) => {
        workerHandlers.set(message.chunkId, handlers.get('message') as any);
      }),
      kill: jest.fn(),
    };
  }),
}));

import { executeBacktestWorkerPool } from '../workerPool';

describe('executeBacktestWorkerPool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workerHandlers.clear();
  });

  it('renders worker heartbeat separately from completed test progress', async () => {
    const onMessage = jest.fn();
    const onFinish = jest.fn(async () => undefined);
    const suite = [
      {
        name: 't1',
        symbol: 'ETHUSDT',
        userName: 'root',
        connectorName: 'ByBit',
      },
    ] as any;

    await executeBacktestWorkerPool({
      testSuite: suite,
      userName: 'root',
      progressStep: 1,
      workerHeapMb: 1024,
      testerWorkerPath: '/tmp/tester.js',
      testerNeedsTsRuntime: false,
      onMessage,
      onWorkerError: jest.fn(),
      onFinish,
      introLines: [],
      chunkTestSuite: () => [suite],
      getProgressSnapshot: () => ({
        symbol: 'ETHUSDT',
        profit: 12,
      }),
    });

    const [chunkId, messageHandler] = [...workerHandlers.entries()][0] ?? [];
    expect(chunkId).toBeTruthy();
    expect(typeof messageHandler).toBe('function');

    messageHandler({
      progress: true,
      testName: 't1',
      symbol: 'ETHUSDT',
      strategyName: 'TrendShift',
      stage: 'strategy signal',
      candleIndex: 10,
      candleTotal: 200,
      elapsedMs: 15_000,
      stageElapsedMs: 6_000,
    });

    expect(progressInterrupt).toHaveBeenCalledWith(
      expect.stringContaining('TrendShift'),
    );
    expect(progressTick).not.toHaveBeenCalled();

    messageHandler({
      test: suite[0],
      orderLogId: 'log-1',
      stat: { amount: 110, profit: 12, orders: 1 },
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(progressTick).toHaveBeenCalledTimes(1);
  });
});
