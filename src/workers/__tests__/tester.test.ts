describe('worker tester', () => {
  const originalSend = process.send;
  let messageHandler: ((msg: { chunkId: string; userName: string }) => void) | null =
    null;

  const setup = async ({
    suite,
    testingImpl,
  }: {
    suite: any[];
    testingImpl: jest.Mock;
  }) => {
    jest.resetModules();
    messageHandler = null;

    jest.doMock('@utils/testing', () => ({
      testing: testingImpl,
    }));

    jest.doMock('@utils/redis', () => ({
      getData: jest.fn(async () => suite),
      redisKeys: {
        cacheChunk: (userName: string, chunkId: string) =>
          `users:${userName}:cache:tests:chunks:${chunkId}`,
      },
    }));

    jest.doMock('@utils/logger', () => ({
      logger: { error: jest.fn() },
    }));

    jest.spyOn(process, 'on').mockImplementation((event: any, listener: any) => {
      if (event === 'message') {
        messageHandler = listener;
      }
      return process;
    });

    await import('../tester');
  };

  afterEach(() => {
    jest.restoreAllMocks();
    process.send = originalSend;
  });

  it('sends test result and done message for successful test', async () => {
    const send = jest.fn();
    process.send = send as any;

    const test = { name: 't1' };
    const testingImpl = jest.fn(async () => ({
      stat: { amount: 100, profit: 0, orders: 1 },
      orderLogId: 'log-1',
    }));

    await setup({ suite: [test], testingImpl });

    await messageHandler?.({ chunkId: 'chunk-1', userName: 'alice' });

    expect(send).toHaveBeenCalledWith({
      stat: { amount: 100, profit: 0, orders: 1 },
      orderLogId: 'log-1',
      test,
    });
    expect(send).toHaveBeenCalledWith({ done: true });
  });

  it('sends error payload and done message when testing throws', async () => {
    const send = jest.fn();
    process.send = send as any;

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
    expect(send).toHaveBeenCalledWith({ done: true });
  });
});
