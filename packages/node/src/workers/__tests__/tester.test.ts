describe('worker tester', () => {
  const originalSend = process.send;
  const originalExit = process.exit;
  const originalDisconnect = process.disconnect;
  let messageHandler:
    | ((msg: { chunkId?: string; chunk?: any[]; userName: string }) => void)
    | null = null;

  const setup = async ({
    suite,
    testingImpl,
    canRunTestsInSharedCandleLoopImpl = jest.fn(() => false),
    testingGroupInSharedCandleLoopImpl = jest.fn(),
  }: {
    suite: any[];
    testingImpl: jest.Mock;
    canRunTestsInSharedCandleLoopImpl?: jest.Mock;
    testingGroupInSharedCandleLoopImpl?: jest.Mock;
  }) => {
    jest.resetModules();
    messageHandler = null;
    const getDataMock = jest.fn(async () => suite);
    const calculateStatsFullMock = jest.fn(() => ({
      amount: 120,
      netProfit: 20,
      orders: 1,
      winRate: 100,
    }));
    const writeCachedBacktestArtifactsMock = jest.fn(async () => ({
      orderLog: {
        kind: 'file',
        version: 1,
        path: 'data/backtests/cache/alice/orders/log-1.json',
      },
      positionLog: {
        kind: 'file',
        version: 1,
        path: 'data/backtests/cache/alice/positions/log-1.json',
      },
    }));
    const configureTimescaleMarketContextSchemaModeMock = jest.fn();

    jest.doMock('../../testing', () => ({
      canRunTestsInSharedCandleLoop: canRunTestsInSharedCandleLoopImpl,
      testing: testingImpl,
      testingGroupInSharedCandleLoop: testingGroupInSharedCandleLoopImpl,
      resetTestingKlineCache: jest.fn(),
      releaseTestingSymbolCache: jest.fn(),
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      getData: getDataMock,
      redisKeys: {
        cacheChunk: (userName: string, chunkId: string) =>
          `users:${userName}:cache:tests:chunks:${chunkId}`,
      },
    }));
    jest.doMock('@tradejs/infra/backtestArtifacts', () => ({
      writeCachedBacktestArtifacts: writeCachedBacktestArtifactsMock,
    }));
    jest.doMock('@tradejs/core/backtest', () => ({
      calculateStatsFull: calculateStatsFullMock,
    }));
    jest.doMock('@tradejs/infra/logger', () => ({
      logger: { error: jest.fn() },
    }));
    jest.doMock('@tradejs/infra/ml', () => ({
      closeAllMlDatasetWriters: jest.fn(async () => undefined),
    }));
    jest.doMock('@tradejs/infra/ai', () => ({
      closeAllAiDatasetWriters: jest.fn(async () => undefined),
    }));
    jest.doMock('@tradejs/infra/timescale/client', () => ({
      configureTimescaleMarketContextSchemaMode:
        configureTimescaleMarketContextSchemaModeMock,
    }));

    jest
      .spyOn(process, 'on')
      .mockImplementation((event: any, listener: any) => {
        if (event === 'message') {
          messageHandler = listener;
        }
        return process;
      });

    await import('../tester');

    return {
      calculateStatsFullMock,
      configureTimescaleMarketContextSchemaModeMock,
      getDataMock,
      writeCachedBacktestArtifactsMock,
    };
  };

  it('switches Timescale market-context access to verify-only before work', async () => {
    const { configureTimescaleMarketContextSchemaModeMock } = await setup({
      suite: [],
      testingImpl: jest.fn(),
    });

    expect(configureTimescaleMarketContextSchemaModeMock).toHaveBeenCalledTimes(
      1,
    );
    expect(configureTimescaleMarketContextSchemaModeMock).toHaveBeenCalledWith(
      'verify',
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.send = originalSend;
    process.exit = originalExit;
    process.disconnect = originalDisconnect;
  });

  it('sends test result and done message for successful test', async () => {
    const send = jest.fn((_message?: unknown, callback?: () => void) => {
      callback?.();
    });
    process.send = send as any;
    process.disconnect = jest.fn() as any;
    process.exit = jest.fn() as any;

    const test = { name: 't1' };
    const orderLog = [{ index: 0 }];
    const positionLog = [{ direction: 'LONG' }];
    const testingImpl = jest.fn(async () => ({
      stat: { amount: 100, profit: 0, orders: 1 },
      orderLogId: 'log-1',
      inlineOrderLog: orderLog,
      inlinePositionLog: positionLog,
    }));

    const {
      calculateStatsFullMock,
      getDataMock,
      writeCachedBacktestArtifactsMock,
    } = await setup({
      suite: [test],
      testingImpl,
    });

    await messageHandler?.({ chunk: [test], userName: 'alice' });

    expect(writeCachedBacktestArtifactsMock).toHaveBeenCalledWith({
      userName: 'alice',
      orderLogId: 'log-1',
      orderLog,
      positionLog,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: { amount: 120, netProfit: 20, orders: 1, winRate: 100 },
        orderLogId: 'log-1',
        test,
      }),
    );
    expect(calculateStatsFullMock).toHaveBeenCalledWith(positionLog);
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        inlineOrderLog: expect.anything(),
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { done: true },
      expect.any(Function),
    );
    expect(getDataMock).not.toHaveBeenCalled();
    expect(process.disconnect).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('sends error payload and done message when testing throws', async () => {
    const send = jest.fn((_message?: unknown, callback?: () => void) => {
      callback?.();
    });
    process.send = send as any;
    process.disconnect = jest.fn() as any;
    process.exit = jest.fn() as any;

    const test = { name: 't2' };
    const testingImpl = jest.fn(async () => {
      throw new Error('boom');
    });

    await setup({ suite: [test], testingImpl });

    await messageHandler?.({ chunkId: 'chunk-1', userName: 'alice' });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: true,
        id: 't2',
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      { done: true },
      expect.any(Function),
    );
    expect(process.disconnect).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('marks every shared candle-loop group test failed when the group throws', async () => {
    const send = jest.fn((_message?: unknown, callback?: () => void) => {
      callback?.();
    });
    process.send = send as any;
    process.disconnect = jest.fn() as any;
    process.exit = jest.fn() as any;

    const first = {
      name: 'group-1',
      symbol: 'ETHUSDT',
      userName: 'alice',
      connectorName: 'ByBit',
    };
    const second = {
      name: 'group-2',
      symbol: 'ETHUSDT',
      userName: 'alice',
      connectorName: 'ByBit',
    };
    const third = {
      name: 'solo-1',
      symbol: 'BTCUSDT',
      userName: 'alice',
      connectorName: 'ByBit',
    };
    const testingImpl = jest.fn(async () => ({
      stat: { amount: 100, profit: 0, orders: 0 },
      orderLogId: 'solo-log',
    }));
    const canRunTestsInSharedCandleLoopImpl = jest.fn(
      (tests: unknown[]) => tests.length <= 2,
    );
    const testingGroupInSharedCandleLoopImpl = jest.fn(async () => {
      throw new Error('group timeout');
    });

    await setup({
      suite: [first, second, third],
      testingImpl,
      canRunTestsInSharedCandleLoopImpl,
      testingGroupInSharedCandleLoopImpl,
    });

    await messageHandler?.({
      chunk: [first, second, third],
      userName: 'alice',
    });

    expect(testingGroupInSharedCandleLoopImpl).toHaveBeenCalledTimes(1);
    expect(testingGroupInSharedCandleLoopImpl).toHaveBeenCalledWith([
      first,
      second,
    ]);
    expect(testingImpl).toHaveBeenCalledTimes(1);
    expect(testingImpl).toHaveBeenCalledWith(third);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: true,
        id: 'group-1',
        symbol: 'ETHUSDT',
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: true,
        id: 'group-2',
        symbol: 'ETHUSDT',
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        test: third,
      }),
    );
    expect(send).toHaveBeenLastCalledWith({ done: true }, expect.any(Function));
  });

  it('falls back to redis chunk lookup when direct chunk payload is not provided', async () => {
    const send = jest.fn((_message?: unknown, callback?: () => void) => {
      callback?.();
    });
    process.send = send as any;
    process.disconnect = jest.fn() as any;
    process.exit = jest.fn() as any;

    const test = { name: 't3' };
    const orderLog = [{ index: 0 }];
    const positionLog = [{ direction: 'SHORT' }];
    const testingImpl = jest.fn(async () => ({
      stat: { amount: 101, profit: 1, orders: 1 },
      orderLogId: 'log-3',
      inlineOrderLog: orderLog,
      inlinePositionLog: positionLog,
    }));

    const {
      calculateStatsFullMock,
      getDataMock,
      writeCachedBacktestArtifactsMock,
    } = await setup({
      suite: [test],
      testingImpl,
    });

    await messageHandler?.({ chunkId: 'chunk-3', userName: 'alice' });

    expect(getDataMock).toHaveBeenCalledTimes(1);
    expect(writeCachedBacktestArtifactsMock).toHaveBeenCalledWith({
      userName: 'alice',
      orderLogId: 'log-3',
      orderLog,
      positionLog,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: { amount: 120, netProfit: 20, orders: 1, winRate: 100 },
        orderLogId: 'log-3',
        test,
      }),
    );
    expect(calculateStatsFullMock).toHaveBeenCalledWith(positionLog);
  });

  it('skips artifact cache writes when fast-mode test results have no inline logs', async () => {
    const send = jest.fn((_message?: unknown, callback?: () => void) => {
      callback?.();
    });
    process.send = send as any;
    process.disconnect = jest.fn() as any;
    process.exit = jest.fn() as any;

    const test = { name: 't-fast', fast: true };
    const testingImpl = jest.fn(async () => ({
      stat: {
        amount: 120,
        netProfit: 20,
        orders: 1,
        winRate: 100,
      },
      orderLogId: 'log-fast',
    }));

    const { calculateStatsFullMock, writeCachedBacktestArtifactsMock } =
      await setup({
        suite: [test],
        testingImpl,
      });

    await messageHandler?.({ chunk: [test], userName: 'alice' });

    expect(writeCachedBacktestArtifactsMock).not.toHaveBeenCalled();
    expect(calculateStatsFullMock).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: {
          amount: 120,
          netProfit: 20,
          orders: 1,
          winRate: 100,
        },
        orderLogId: 'log-fast',
        test,
      }),
    );
  });
});
