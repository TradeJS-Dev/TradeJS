describe('CLI tester worker bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('switches Timescale market-context access to verify-only on import', async () => {
    const configureTimescaleMarketContextSchemaMode = jest.fn();

    jest.doMock('@tradejs/node/backtest', () => ({
      canRunTestsInSharedCandleLoop: jest.fn(),
      releaseTestingSymbolCache: jest.fn(),
      resetTestingKlineCache: jest.fn(),
      testing: jest.fn(),
      testingGroupInSharedCandleLoop: jest.fn(),
    }));
    jest.doMock('@tradejs/core/backtest', () => ({
      calculateStatsFull: jest.fn(),
    }));
    jest.doMock('@tradejs/infra/backtestArtifacts', () => ({
      writeCachedBacktestArtifacts: jest.fn(),
    }));
    jest.doMock('@tradejs/infra/ai', () => ({
      closeAllAiDatasetWriters: jest.fn(),
    }));
    jest.doMock('@tradejs/infra/logger', () => ({
      logger: { error: jest.fn() },
    }));
    jest.doMock('@tradejs/infra/ml', () => ({
      closeAllMlDatasetWriters: jest.fn(),
    }));
    jest.doMock('@tradejs/infra/redis', () => ({
      getData: jest.fn(),
      redisKeys: { cacheChunk: jest.fn() },
    }));
    jest.doMock('@tradejs/infra/timescale/client', () => ({
      configureTimescaleMarketContextSchemaMode,
    }));
    jest.spyOn(process, 'on').mockImplementation(() => process);

    await import('../workers/testerWorker');

    expect(configureTimescaleMarketContextSchemaMode).toHaveBeenCalledTimes(1);
    expect(configureTimescaleMarketContextSchemaMode).toHaveBeenCalledWith(
      'verify',
    );
  });
});
