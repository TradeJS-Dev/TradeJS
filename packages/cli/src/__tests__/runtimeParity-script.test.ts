export {};

const setupRuntimeParityModule = async (
  flagOverrides: Record<string, unknown> = {},
) => {
  jest.resetModules();

  const sendTextToTG = jest.fn(
    async (_message: string, _options?: unknown) => null,
  );
  const update = jest.fn(async () => null);
  const getKeys = jest.fn(async (_prefix: string) => []);
  const getData = jest.fn(async (_key: string, fallback: unknown) => fallback);
  const resetTestingKlineCache = jest.fn();
  const testing = jest.fn();
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
    getConnectorCreatorByName: jest.fn(),
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
    getKeys,
    getData,
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
        runtimeUniverse: 0,
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
    expect(message).toContain('Runtime gates: <b>enabled</b>');
    expect(message).toContain('Targets: <b>5</b>, compared: <b>5</b>');
    expect(message).toContain(
      'TrendLine: targets=<b>5</b>, compared=<b>5</b>, errors=<b>0</b>',
    );
    expect(message).toContain(
      'Backtest-only: <code>gated_out=1, order_failed=0, core_skipped=0, not_evaluated=0, true_mismatch=0</code>',
    );
    expect(message).toContain(
      'TrendLine BTCUSDT: <code>boom &lt;fail&gt;</code>',
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
});
