export {};

const setupRuntimeParityModule = async (
  flagOverrides: Record<string, unknown> = {},
) => {
  jest.resetModules();

  const sendTextToTG = jest.fn(
    async (_message: string, _options?: unknown) => null,
  );
  const sendDocumentToTG = jest.fn(
    async (_document: unknown, _options?: unknown) => null,
  );
  const getTickers: jest.Mock<Promise<string[]>, []> = jest.fn(async () => []);
  const update = jest.fn(async () => null);
  const getKeys = jest.fn(async (_prefix: string): Promise<string[]> => []);
  const getData = jest.fn(async (_key: string, fallback: unknown) => fallback);
  const getHashJsonValues = jest.fn(async () => []);
  const loadRuntimeSignals = jest.fn(
    async (_userName: string): Promise<any[]> => [],
  );
  const loadRuntimeSignalEvaluations = jest.fn(
    async (_userName: string): Promise<any[]> => [],
  );
  const releaseTestingSymbolCache = jest.fn();
  const resetTestingKlineCache = jest.fn();
  const testing = jest.fn();
  const connector = {
    getTickers: jest.fn(async (): Promise<string[]> => []),
  };
  const getConnectorCreatorByName = jest.fn(async () => async () => connector);
  const logger = {
    log: jest.fn(),
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
    sendDocumentToTG,
    sendTextToTG,
    update,
  }));

  jest.doMock('@tradejs/infra/logger', () => ({
    __esModule: true,
    logger,
  }));

  jest.doMock('@tradejs/infra/timescale', () => ({
    ...jest.requireActual('@tradejs/infra/timescale'),
    ensureMarketContextSchemas: jest.fn(async () => undefined),
  }));

  jest.doMock('@tradejs/infra/redis', () => {
    const redisKeys = {
      strategies: (userName: string) => `users:${userName}:strategies`,
      runtimeTrades: (userName: string) =>
        `users:${userName}:runtime:trade-records:`,
      runtimeTradeBuckets: (userName: string) =>
        `users:${userName}:runtime:trade-records:days:`,
      runtimeTradeBucket: (userName: string, dayKey: string) =>
        `users:${userName}:runtime:trade-records:days:${dayKey}`,
      strategyResults: (userName: string, strategy: string) =>
        `users:${userName}:strategies:${strategy}:results`,
      strategyConfig: (userName: string, strategy: string) =>
        `users:${userName}:strategies:${strategy}:config`,
    };

    return {
      __esModule: true,
      getKeys,
      getData,
      getHashJsonValues,
      redisKeys,
    };
  });

  jest.doMock('@tradejs/node/connectors', () => ({
    __esModule: true,
    DEFAULT_CONNECTOR_NAME: 'bybit',
    getConnectorCreatorByName,
    resolveConnectorName: jest.fn(async () => 'bybit'),
  }));

  jest.doMock('../lib/runtimeSignalsLoader', () => ({
    __esModule: true,
    loadRuntimeSignalEvaluations,
    loadRuntimeSignals,
  }));

  jest.doMock('@tradejs/node/backtest', () => ({
    __esModule: true,
    releaseTestingSymbolCache,
    resetTestingKlineCache,
    testing,
  }));

  const mod = await import('../scripts/runtimeParity');

  return {
    mod,
    sendDocumentToTG,
    sendTextToTG,
    getTickers,
    getKeys,
    getData,
    loadRuntimeSignalEvaluations,
    loadRuntimeSignals,
    getConnectorCreatorByName,
    releaseTestingSymbolCache,
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
            signalId: 'sig-rt-1',
          },
          classification: 'gated_out',
          reason: 'AI_QUALITY_BELOW_MIN',
          evaluation: {
            evaluationId: 'eval-rt-1',
            userName: 'root',
            strategy: 'TrendLine',
            symbol: 'BTCUSDT',
            interval: '15',
            timestamp: 1_700_000_000_000,
            evaluatedAt: 1_700_000_000_000,
            status: 'skip',
            signalId: 'sig-rt-1',
          },
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
    expect(message).not.toContain('Runtime gates:');
    expect(message).toContain(
      '• Targets: <b>5</b> / compared <b>5</b> / errors <b>1</b>',
    );
    expect(message).toContain(
      '• Sources: <b>runtime trades=5, strategy results=5</b>',
    );
    expect(message).toContain('🔎 <b>Mismatches</b>');
    expect(message).toContain(
      'runtimeOnly [gated_out] signalId=sig-rt-1 orderId=rt-1 evaluationId=eval-rt-1 evaluationStatus=skip TrendLine BTCUSDT LONG',
    );
    expect(message).toContain(
      'backtestOnly [gated_out] signalId=bt-1 TrendLine BTCUSDT LONG',
    );
    expect(message).toContain(
      '• Runtime-only classes: <code>gated_out=1</code>',
    );
    expect(message).toContain(
      '• Backtest-only classes: <code>gated_out=1</code>',
    );
    expect(message).toContain(
      '• Matched deltas: price avg/max=<b>0.25% / 0.50%</b>, time avg/max=<b>1.00m / 2.00m</b>',
    );
    expect(message).not.toContain('• Matched:');
    expect(message).toContain('📊 <b>Strategy issues</b>');
    expect(message).toContain(
      '• TrendLine: backtestOnly=2, runtimeDuplicates=1',
    );
    expect(message).toContain(
      '• <b>TrendLine</b> BTCUSDT: <code>boom &lt;fail&gt;</code>',
    );
  });

  it('omits duplicate and clean strategy noise in Telegram summary', async () => {
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
      replayTargetsCount: 3,
      comparedTargetsCount: 3,
      replayErrors: [],
      sourceCounts: {
        runtime: 3,
        connectorUniverse: 0,
        explicitTickers: 0,
        strategyResults: 0,
      },
      rawRuntimeEntriesCount: 3,
      runtimeEntriesCount: 3,
      runtimeDuplicateEntriesCount: 0,
      backtestEntriesCount: 3,
      matchedCount: 3,
      runtimeOnlyCount: 0,
      backtestOnlyCount: 0,
      matchedSummary: {
        avgPriceDeltaPct: 0.14,
        maxPriceDeltaPct: 0.25,
        avgTimestampDiffMs: 0,
        maxTimestampDiffMs: 0,
      },
      classifiedRuntimeOnly: [],
      classifiedBacktestOnly: [],
      runtimeSignalEvaluationsCount: 634,
      strategyRows: [
        [
          'ReverseTrendLine',
          {
            targets: 1,
            compared: 1,
            errors: 0,
            runtime: 1,
            runtimeDuplicates: 0,
            backtest: 1,
            matched: 1,
            runtimeOnly: 0,
            backtestOnly: 0,
          },
        ],
        [
          'TrendLine',
          {
            targets: 1,
            compared: 1,
            errors: 0,
            runtime: 1,
            runtimeDuplicates: 0,
            backtest: 1,
            matched: 1,
            runtimeOnly: 0,
            backtestOnly: 0,
          },
        ],
        [
          'TrendShift',
          {
            targets: 1,
            compared: 1,
            errors: 0,
            runtime: 1,
            runtimeDuplicates: 0,
            backtest: 1,
            matched: 1,
            runtimeOnly: 0,
            backtestOnly: 0,
          },
        ],
      ],
      runtimeGateWarningCounts: new Map(),
    });

    expect(message).toContain('• Runtime: <b>3</b>');
    expect(message).toContain(
      '• Matched deltas: price avg/max=<b>0.14% / 0.25%</b>, time avg/max=<b>0.00m / 0.00m</b>',
    );
    expect(message).toContain('• Sources: <b>runtime trades=3</b>');
    expect(message).not.toContain('deduped');
    expect(message).not.toContain('dup <b>0</b>');
    expect(message).not.toContain('• Matched:');
    expect(message).not.toContain('📊 <b>Strategy issues</b>');
    expect(message).toContain(
      '📊 <b>Strategies</b>: clean <b>3</b> / total <b>3</b>',
    );
    expect(message).not.toContain('compared=<b>1</b>');
    expect(message).not.toContain('errors=<b>0</b>');
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

  it('attaches mismatch json when Telegram parity report has divergences', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const startTime = 1_700_000_000_000;
    const endTime = startTime + 86_400_000;
    const {
      mod,
      sendDocumentToTG,
      sendTextToTG,
      getKeys,
      getData,
      testing,
      resetTestingKlineCache,
    } = await setupRuntimeParityModule({
      startTime,
      endTime,
      notify: true,
      runtimeGates: true,
      cacheOnly: true,
    });

    getKeys.mockImplementation(async (prefix: string) => {
      if (prefix === 'users:root:strategies:') {
        return ['users:root:strategies:TrendLine:config'];
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
      if (key === 'users:root:strategies:TrendLine:results') {
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
      inlineReplaySignalEvaluations: [
        {
          evaluationId: 'eval-1',
          userName: 'root',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          interval: '15',
          timestamp: startTime + 900_000,
          evaluatedAt: startTime + 900_000,
          status: 'skip',
          signalId: 'sig-1',
          direction: 'LONG',
          reason: 'NO_SIGNAL',
        },
      ],
    });

    await mod.runtimeParity();

    expect(sendTextToTG).toHaveBeenCalledTimes(1);
    expect(sendDocumentToTG).toHaveBeenCalledTimes(1);
    expect(sendDocumentToTG.mock.calls[0]?.[1]).toEqual({ userName: 'root' });

    const attachment = sendDocumentToTG.mock.calls[0]?.[0] as {
      filename: string;
      content: string;
      caption?: string;
    };
    expect(attachment.filename).toBe(
      `runtime-parity-mismatches-bybit-${startTime}-${endTime}.json`,
    );
    expect(attachment.caption).toBe('Runtime parity mismatch JSON');

    const payload = JSON.parse(attachment.content);
    expect(payload.kind).toBe('tradejs-runtime-parity-mismatches');
    expect(payload.codexQuestion).toContain(
      'explain why runtime and replay/backtest diverged',
    );
    expect(payload.summary.runtimeOnlyEntries).toBe(1);
    expect(payload.summary.backtestOnlyEntries).toBe(0);
    expect(payload.cases).toEqual([
      expect.objectContaining({
        kind: 'runtimeOnly',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        signalRefs: expect.objectContaining({
          signalId: 'sig-1',
          orderId: 'ord-1',
          evaluationId: 'eval-1',
        }),
        why: expect.objectContaining({
          classification: 'core_skipped',
          reason: 'NO_SIGNAL',
        }),
        recommendedChecks: expect.arrayContaining([
          'Check replay evaluation.status',
        ]),
      }),
    ]);
    expect(payload.cases[0].why.likelyCause).toContain(
      'Replay strategy core did not emit a signal',
    );
    expect(payload.mismatches.runtimeOnly).toEqual([
      expect.objectContaining({
        classification: 'core_skipped',
        reason: 'NO_SIGNAL',
        runtimeEntry: expect.objectContaining({
          signalId: 'sig-1',
          orderId: 'ord-1',
          symbol: 'BTCUSDT',
        }),
        replayEvaluation: expect.objectContaining({
          evaluationId: 'eval-1',
          status: 'skip',
          signalId: 'sig-1',
        }),
      }),
    ]);

    expect(resetTestingKlineCache).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('injects AI replay snapshots from runtime signal evaluations', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const startTime = 1_700_000_000_000;
    const endTime = startTime + 86_400_000;
    const { mod, getKeys, getData, loadRuntimeSignalEvaluations, testing } =
      await setupRuntimeParityModule({
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
      return [];
    });
    loadRuntimeSignalEvaluations.mockResolvedValue([
      {
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
      },
    ]);
    getData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:strategies:TrendLine:config') {
        return { AI_ENABLED: true };
      }
      if (key === 'users:root:strategies:TrendLine:results') {
        return {};
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

  it('auto-replays runtime-gated configs in PARITY env without runtimeGates flag', async () => {
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
      runtimeGates: false,
      cacheOnly: true,
    });

    getKeys.mockImplementation(async (prefix: string) => {
      if (prefix === 'users:root:strategies:') {
        return ['users:root:strategies:TrendLine:config'];
      }
      return [];
    });
    getData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:strategies:TrendLine:config') {
        return { AI_ENABLED: true, AI_MODE: 'llm' };
      }
      if (key === 'users:root:strategies:TrendLine:results') {
        return {};
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
        AI_ENABLED: true,
        AI_MODE: 'llm',
        ENV: 'PARITY',
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
    const { mod, getTickers, getKeys, getData, loadRuntimeSignals, testing } =
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
    loadRuntimeSignals.mockResolvedValue([]);
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
