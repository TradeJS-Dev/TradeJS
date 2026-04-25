export {};

const setupRuntimeParityModule = async (
  flagOverrides: Record<string, unknown> = {},
) => {
  jest.resetModules();

  const sendTextToTG = jest.fn(
    async (_message: string, _options?: unknown) => null,
  );
  const getTickers: jest.Mock<Promise<string[]>, []> = jest.fn(async () => []);
  const update = jest.fn(async () => null);
  const getKeys = jest.fn(async (_prefix: string): Promise<string[]> => []);
  const getData = jest.fn(async (_key: string, fallback: unknown) => fallback);
  const resetTestingKlineCache = jest.fn();
  const testing = jest.fn();
  const connector = {
    getTickers: jest.fn(async (): Promise<string[]> => []),
  };
  const getConnectorCreatorByName = jest.fn(async () => async () => connector);
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  jest.doMock('args', () => ({
    __esModule: true,
    default: {
      option: jest.fn(),
      parse: jest.fn(() => ({
        user: 'root',
        connector: 'bybit',
        days: 1,
        cacheOnly: true,
        toleranceBars: 1,
        runtimeGates: true,
        notify: false,
        details: false,
        ...flagOverrides,
      })),
    },
  }));

  jest.doMock('@tradejs/node/cli', () => ({
    __esModule: true,
    getTickers,
    sendTextToTG,
    update,
  }));

  jest.doMock('@tradejs/infra/logger', () => ({
    __esModule: true,
    logger,
  }));

  jest.doMock('@tradejs/infra/redis', () => {
    const redisKeys = {
      strategies: (userName: string) => `users:${userName}:strategies`,
      runtimeTrades: (userName: string) =>
        `users:${userName}:runtime:trade-records:`,
      runtimeSignals: (userName: string) =>
        `users:${userName}:runtime:signals:`,
      runtimeSignalEvaluations: (userName: string) =>
        `users:${userName}:runtime:signal-evaluations:`,
      strategyResults: (userName: string, strategy: string) =>
        `users:${userName}:strategies:${strategy}:results`,
      strategyConfig: (userName: string, strategy: string) =>
        `users:${userName}:strategies:${strategy}:config`,
    };

    return {
      __esModule: true,
      getKeys,
      getData,
      redisKeys,
    };
  });

  jest.doMock('@tradejs/node/connectors', () => ({
    __esModule: true,
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName,
    resolveConnectorName: jest.fn(async () => 'bybit'),
  }));

  jest.doMock('@tradejs/node/backtest', () => ({
    __esModule: true,
    resetTestingKlineCache,
    testing,
  }));

  const mod = await import('../scripts/runtimeParity');

  return {
    mod,
    sendTextToTG,
    getTickers,
    getKeys,
    getData,
    getConnectorCreatorByName,
    resetTestingKlineCache,
    testing,
  };
};

describe('runtime parity script', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('builds a Telegram-friendly runtime parity message', async () => {
    const { mod } = await setupRuntimeParityModule();

    const message = mod.buildRuntimeParityMessage({
      window: {
        start: 1_700_000_000_000,
        end: 1_700_086_400_000,
      },
      connectorName: 'bybit',
      replayEnv: 'PARITY',
      runtimeGatesEnabled: true,
      toleranceBars: 1,
      toleranceMs: 900_000,
      replayTargetsCount: 5,
      comparedTargetsCount: 5,
      replayErrors: [
        {
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          sources: ['runtime'],
          message: 'boom <fail>',
        },
      ],
      sourceCounts: {
        runtime: 5,
        connectorUniverse: 0,
        explicitTickers: 0,
        strategyResults: 5,
      },
      rawRuntimeEntriesCount: 2,
      runtimeEntriesCount: 1,
      runtimeDuplicateEntriesCount: 1,
      backtestEntriesCount: 3,
      matchedCount: 1,
      runtimeOnlyCount: 0,
      backtestOnlyCount: 2,
      matchedSummary: {
        avgPriceDeltaPct: 0.25,
        maxPriceDeltaPct: 0.5,
        avgTimestampDiffMs: 60_000,
        maxTimestampDiffMs: 120_000,
      },
      classifiedRuntimeOnly: [
        {
          entry: {
            id: 'rt-1',
            source: 'runtime',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1_700_000_000_000,
            price: 100,
          },
          classification: 'gated_out',
          reason: 'AI_QUALITY_BELOW_MIN',
        },
      ],
      classifiedBacktestOnly: [
        {
          entry: {
            id: 'bt-1',
            source: 'backtest',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            timestamp: 1_700_000_000_000,
            price: 100,
          },
          classification: 'gated_out',
          reason: 'AI_QUALITY_BELOW_MIN',
        },
      ],
      runtimeSignalEvaluationsCount: 4,
      strategyRows: [
        [
          'TrendLine',
          {
            targets: 5,
            compared: 5,
            errors: 0,
            runtime: 1,
            runtimeDuplicates: 1,
            backtest: 3,
            matched: 1,
            runtimeOnly: 0,
            backtestOnly: 2,
          },
        ],
      ],
      runtimeGateWarningCounts: new Map(),
    });

    expect(message).toContain('<b>TradeJS runtime parity</b>');
    expect(message).toContain('Replay env: <b>PARITY</b>');
    expect(message).toContain('Runtime gates: <b>✅ enabled</b>');
    expect(message).toContain(
      '• Targets: <b>5</b> / compared <b>5</b> / errors <b>1</b>',
    );
    expect(message).toContain(
      '<b>TrendLine</b>\n• targets=<b>5</b>, compared=<b>5</b>, errors=<b>0</b>',
    );
    expect(message).toContain(
      '• Runtime-only classes: <code>gated_out=1, order_failed=0, core_skipped=0, backtest_drift=0, not_evaluated=0, true_mismatch=0</code>',
    );
    expect(message).toContain(
      '• Backtest-only classes: <code>gated_out=1, order_failed=0, core_skipped=0, not_evaluated=0, true_mismatch=0</code>',
    );
    expect(message).toContain(
      '• <b>TrendLine</b> BTCUSDT: <code>boom &lt;fail&gt;</code>',
    );
  });

  it('sends a Telegram report when no replay targets are found', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_086_400_000);
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const { mod, sendTextToTG, resetTestingKlineCache } =
      await setupRuntimeParityModule({
        notify: true,
      });

    await mod.runtimeParity();

    expect(sendTextToTG).toHaveBeenCalledTimes(1);
    expect(sendTextToTG).toHaveBeenCalledWith(
      expect.stringContaining('No replay targets found for user <b>root</b>.'),
      { userName: 'root' },
    );
    expect(sendTextToTG).toHaveBeenCalledWith(
      expect.stringContaining('Replay env: <b>PARITY</b>'),
      { userName: 'root' },
    );
    expect(resetTestingKlineCache).toHaveBeenCalled();

    logSpy.mockRestore();
  });

  it('injects AI replay snapshots from runtime signal evaluations', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const startTime = 1_700_000_000_000;
    const endTime = startTime + 86_400_000;
    const { mod, getKeys, getData, testing } = await setupRuntimeParityModule({
      startTime,
      endTime,
      strategy: 'TrendLine',
      tickers: 'ETHUSDT',
      runtimeGates: true,
      cacheOnly: true,
    });
    const aiAnalysis = {
      direction: null,
      quality: 3,
      comment: 'reject',
    };

    getKeys.mockImplementation(async (prefix: string) => {
      if (prefix === 'users:root:strategies:') {
        return ['users:root:strategies:TrendLine:config'];
      }
      if (prefix === 'users:root:runtime:signal-evaluations:') {
        return ['users:root:runtime:signal-evaluations:eval-1'];
      }
      return [];
    });
    getData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:strategies:TrendLine:config') {
        return { AI_ENABLED: true };
      }
      if (key === 'users:root:strategies:TrendLine:results') {
        return {};
      }
      if (key === 'users:root:runtime:signal-evaluations:eval-1') {
        return {
          evaluationId: 'eval-1',
          userName: 'root',
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          interval: '15',
          timestamp: startTime + 900_000,
          evaluatedAt: startTime + 900_000,
          status: 'signal',
          signalId: 'sig-1',
          direction: 'LONG',
          orderStatus: 'skipped',
          orderSkipReason: 'AI_QUALITY_BELOW_MIN (0 < 4)',
          aiAnalysis,
        };
      }
      return fallback;
    });
    testing.mockResolvedValue({
      inlineOrderLog: [],
      inlineReplaySignalEvaluations: [],
    });

    await mod.runtimeParity();

    expect(testing).toHaveBeenCalledTimes(1);
    expect(testing.mock.calls[0]?.[0]?.strategyConfig).toEqual(
      expect.objectContaining({
        AI_REPLAY_ANALYSES: [
          {
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp: startTime + 900_000,
            toleranceMs: 900_000,
            analysis: aiAnalysis,
          },
        ],
      }),
    );

    logSpy.mockRestore();
  });

  it('builds replay targets from runtime trades and strategy results by default', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const startTime = 1_700_000_000_000;
    const endTime = startTime + 86_400_000;
    const { mod, getTickers, getKeys, getData, testing } =
      await setupRuntimeParityModule({
        startTime,
        endTime,
        runtimeGates: true,
        cacheOnly: true,
      });

    getTickers.mockImplementation(async () => ['BTCUSDT', 'ETHUSDT']);
    getKeys.mockImplementation(async (prefix: string) => {
      if (prefix === 'users:root:strategies:') {
        return [
          'users:root:strategies:TrendLine:config',
          'users:root:strategies:VolumeDivergence:config',
        ];
      }
      if (prefix === 'users:root:runtime:trade-records:') {
        return ['users:root:runtime:trade-records:ord-1'];
      }
      return [];
    });
    getData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:strategies:TrendLine:config') {
        return {};
      }
      if (key === 'users:root:strategies:VolumeDivergence:config') {
        return {};
      }
      if (key === 'users:root:strategies:TrendLine:results') {
        return {
          ETHUSDT: {
            config: {},
          },
        };
      }
      if (key === 'users:root:strategies:VolumeDivergence:results') {
        return {};
      }
      if (key === 'users:root:runtime:trade-records:ord-1') {
        return {
          orderId: 'ord-1',
          signalId: 'sig-1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: startTime + 900_000,
          status: 'closed',
        };
      }
      return fallback;
    });
    testing.mockResolvedValue({
      inlineOrderLog: [],
      inlineReplaySignalEvaluations: [],
    });

    await mod.runtimeParity();

    expect(testing).toHaveBeenCalledTimes(2);
    expect(
      testing.mock.calls.map(([call]) => ({
        strategyName: call.strategyName,
        symbol: call.symbol,
      })),
    ).toEqual([
      { strategyName: 'TrendLine', symbol: 'BTCUSDT' },
      { strategyName: 'TrendLine', symbol: 'ETHUSDT' },
    ]);

    logSpy.mockRestore();
  });

  it('builds replay targets from the full connector universe when requested', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const startTime = 1_700_000_000_000;
    const endTime = startTime + 86_400_000;
    const { mod, getTickers, getKeys, getData, testing } =
      await setupRuntimeParityModule({
        startTime,
        endTime,
        runtimeGates: true,
        cacheOnly: true,
        fullUniverse: true,
      });

    getTickers.mockImplementation(async () => ['BTCUSDT', 'ETHUSDT']);
    getKeys.mockImplementation(async (prefix: string) => {
      if (prefix === 'users:root:strategies:') {
        return [
          'users:root:strategies:TrendLine:config',
          'users:root:strategies:VolumeDivergence:config',
        ];
      }
      return [];
    });
    getData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:strategies:TrendLine:config') {
        return {};
      }
      if (key === 'users:root:strategies:VolumeDivergence:config') {
        return {};
      }
      if (key === 'users:root:strategies:TrendLine:results') {
        return {};
      }
      if (key === 'users:root:strategies:VolumeDivergence:results') {
        return {};
      }
      return fallback;
    });
    testing.mockResolvedValue({
      inlineOrderLog: [],
      inlineReplaySignalEvaluations: [],
    });

    await mod.runtimeParity();

    expect(testing).toHaveBeenCalledTimes(4);
    expect(
      testing.mock.calls.map(([call]) => ({
        strategyName: call.strategyName,
        symbol: call.symbol,
      })),
    ).toEqual([
      { strategyName: 'TrendLine', symbol: 'BTCUSDT' },
      { strategyName: 'TrendLine', symbol: 'ETHUSDT' },
      { strategyName: 'VolumeDivergence', symbol: 'BTCUSDT' },
      { strategyName: 'VolumeDivergence', symbol: 'ETHUSDT' },
    ]);

    logSpy.mockRestore();
  });
});
