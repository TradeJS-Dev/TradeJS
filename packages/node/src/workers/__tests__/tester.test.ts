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
  }: {
    suite: any[];
    testingImpl: jest.Mock;
  }) => {
    jest.resetModules();
    messageHandler = null;
    const getDataMock = jest.fn(async () => suite);
    const setDataMock = jest.fn(async () => undefined);

    jest.doMock('../../testing', () => ({
      testing: testingImpl,
      resetTestingKlineCache: jest.fn(),
      releaseTestingSymbolCache: jest.fn(),
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      getData: getDataMock,
      setData: setDataMock,
      redisKeys: {
        cacheChunk: (userName: string, chunkId: string) =>
          `users:${userName}:cache:tests:chunks:${chunkId}`,
        cacheOrders: (userName: string, orderLogId: string) =>
          `users:${userName}:cache:tests:orders:${orderLogId}`,
        cachePositions: (userName: string, orderLogId: string) =>
          `users:${userName}:cache:tests:positions:${orderLogId}`,
      },
    }));
    jest.doMock('@tradejs/core/constants', () => ({
      TTL_1D: 86400,
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

    jest
      .spyOn(process, 'on')
      .mockImplementation((event: any, listener: any) => {
        if (event === 'message') {
          messageHandler = listener;
        }
        return process;
      });

    await import('../tester');

    return { getDataMock, setDataMock };
  };

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

    const { getDataMock, setDataMock } = await setup({
      suite: [test],
      testingImpl,
    });

    await messageHandler?.({ chunk: [test], userName: 'alice' });

    expect(setDataMock).toHaveBeenCalledTimes(2);
    const firstSetDataCall = (setDataMock.mock.calls[0] ?? []) as any[];
    const secondSetDataCall = (setDataMock.mock.calls[1] ?? []) as any[];
    expect(firstSetDataCall[1]).toBe(orderLog);
    expect(secondSetDataCall[1]).toBe(positionLog);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: { amount: 100, profit: 0, orders: 1 },
        orderLogId: 'log-1',
        test,
      }),
    );
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

    const { getDataMock, setDataMock } = await setup({
      suite: [test],
      testingImpl,
    });

    await messageHandler?.({ chunkId: 'chunk-3', userName: 'alice' });

    expect(getDataMock).toHaveBeenCalledTimes(1);
    const firstSetDataCall = (setDataMock.mock.calls[0] ?? []) as any[];
    const secondSetDataCall = (setDataMock.mock.calls[1] ?? []) as any[];
    expect(firstSetDataCall[1]).toBe(orderLog);
    expect(secondSetDataCall[1]).toBe(positionLog);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        stat: { amount: 101, profit: 1, orders: 1 },
        orderLogId: 'log-3',
        test,
      }),
    );
  });
});
