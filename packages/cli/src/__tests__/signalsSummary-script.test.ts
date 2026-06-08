export {};

describe('signals summary script', () => {
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as any);

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    exitSpy.mockRestore();
  });

  it('aggregates signal statuses and trade pnl by strategy', async () => {
    jest.resetModules();

    const now = 1_700_086_400_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const sendTextToTG = jest.fn(
      async (_message: string, _options?: unknown) => null,
    );
    const sendDocumentToTG = jest.fn(
      async (_document: unknown, _options?: unknown) => null,
    );
    const setData = jest.fn(async () => null);
    const setHashJsonField = jest.fn(async () => null);
    const delKey = jest.fn(async () => true);
    const loadRuntimeSignals = jest.fn(async () => [
      {
        signalId: 'sig-1',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        direction: 'LONG',
        timestamp: now - 60_000,
        orderStatus: 'completed',
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
        figures: {},
        indicators: {},
        additionalIndicators: {},
      },
      {
        signalId: 'sig-2',
        strategy: 'ReverseTrendLine',
        symbol: 'ETHUSDT',
        interval: '15',
        direction: 'SHORT',
        timestamp: now - 120_000,
        orderStatus: 'skipped',
        prices: {
          currentPrice: 50,
          takeProfitPrice: 45,
          stopLossPrice: 55,
          riskRatio: 1,
        },
        figures: {},
        indicators: {},
        additionalIndicators: {},
      },
    ]);
    const loadRuntimeSignalEvaluationStatsBuckets = jest.fn(async () => [
      {
        key: 'users:root:runtime:signal-evaluation-stats:days:2023-11-15:TrendLine',
        dayKey: '2023-11-15',
        strategy: 'TrendLine',
        stats: {
          evaluated: 1,
          signals: 1,
          reasonGroups: new Map(),
        },
      },
      {
        key: 'users:root:runtime:signal-evaluation-stats:days:2023-11-15:ReverseTrendLine',
        dayKey: '2023-11-15',
        strategy: 'ReverseTrendLine',
        stats: {
          evaluated: 1,
          signals: 1,
          reasonGroups: new Map([
            ['skip from AI', new Map([['MIN_AI_QUALITY', 1]])],
          ]),
        },
      },
    ]);
    const loadRuntimeSignalEvaluations = jest.fn(async () => [
      {
        evaluationId: 'TrendLine:BTCUSDT:1700086340000',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: now - 60_000,
        evaluatedAt: now - 30_000,
        status: 'signal',
        reason: 'completed',
        signalId: 'sig-1',
        direction: 'LONG',
        orderStatus: 'completed',
      },
    ]);
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const redisKeys = {
      strategies: (userName: string) => `users:${userName}:strategies`,
      runtimeTrades: (userName: string) =>
        `users:${userName}:runtime:trade-records:`,
      runtimeTrade: (userName: string, orderId: string) =>
        `users:${userName}:runtime:trade-records:${orderId}`,
      runtimeTradeBucket: (userName: string, dayKey: string) =>
        `users:${userName}:runtime:trade-records:days:${dayKey}`,
      runtimeTradeBuckets: (userName: string) =>
        `users:${userName}:runtime:trade-records:days:`,
      runtimeActiveTrade: (userName: string, symbol: string) =>
        `users:${userName}:runtime:active-trades:${symbol}`,
      runtimeActiveTrades: (userName: string) =>
        `users:${userName}:runtime:active-trades:`,
      storeSignal: (symbol: string, signalId: string) =>
        `store:signals:${symbol}:${signalId}`,
      runtimeSignalBuckets: (userName: string) =>
        `users:${userName}:runtime:signals:days:`,
      runtimeSignalEvaluation: (userName: string, evaluationId: string) =>
        `users:${userName}:runtime:signal-evaluations:${evaluationId}`,
      runtimeSignalEvaluationBucket: (
        userName: string,
        dayKey: string,
        strategyName: string,
      ) =>
        `users:${userName}:runtime:signal-evaluations:days:${dayKey}:${strategyName}`,
      runtimeSignalEvaluationBuckets: (userName: string) =>
        `users:${userName}:runtime:signal-evaluations:days:`,
      runtimeSignalEvaluationStatsBuckets: (userName: string) =>
        `users:${userName}:runtime:signal-evaluation-stats:days:`,
    };
    const runtimeTradeKeys = [
      redisKeys.runtimeTrades('root') + 'ord-1',
      redisKeys.runtimeTrades('root') + 'ord-2',
    ];
    const strategyConfigKeys = [
      `${redisKeys.strategies('root')}:TrendLine:config`,
      `${redisKeys.strategies('root')}:ReverseTrendLine:config`,
    ];
    const records = new Map<string, unknown>([
      [
        runtimeTradeKeys[0],
        {
          orderId: 'ord-1',
          signalId: 'sig-1',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          qty: 1,
          entryPrice: 100,
          entryTimestamp: now - 60_000,
          status: 'active',
        },
      ],
      [
        runtimeTradeKeys[1],
        {
          orderId: 'ord-2',
          signalId: 'sig-2',
          strategy: 'ReverseTrendLine',
          symbol: 'ETHUSDT',
          direction: 'SHORT',
          qty: 2,
          entryPrice: 50,
          entryTimestamp: now - 120_000,
          status: 'active',
        },
      ],
      [redisKeys.runtimeActiveTrade('root', 'BTCUSDT'), { orderId: 'ord-1' }],
      [redisKeys.runtimeActiveTrade('root', 'ETHUSDT'), { orderId: 'ord-2' }],
    ]);
    const getKeys = jest.fn(async (prefix: string) => {
      if (prefix === `${redisKeys.strategies('root')}:`) {
        return strategyConfigKeys;
      }
      if (prefix === redisKeys.runtimeTrades('root')) {
        return runtimeTradeKeys;
      }
      return [];
    });
    const getData = jest.fn(async (key: string, fallback: unknown) =>
      records.has(key) ? records.get(key) : fallback,
    );
    const connector = {
      getOpenPositionPnl: jest.fn(async () => [
        {
          symbol: 'BTCUSDT',
          qty: 1,
          price: 100,
          currentPrice: 112,
          unrealizedPnl: -12,
          direction: 'LONG',
        },
      ]),
      getClosedPnl: jest.fn(async () => [
        {
          symbol: 'ETHUSDT',
          qty: 2,
          entryPrice: 50,
          exitPrice: 52,
          closedPnl: -4,
          closedAt: now - 30_000,
          orderId: 'bybit-1',
        },
      ]),
    };

    jest.doMock('args', () => ({
      __esModule: true,
      default: {
        option: jest.fn(),
        parse: jest.fn(() => ({
          user: 'root',
          connector: 'bybit',
          hours: 24,
          printOnly: false,
        })),
      },
    }));

    jest.doMock('@tradejs/core/constants', () => ({
      TTL_1M: 2_600_000,
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      delKey,
      getData,
      getKeys,
      redisKeys,
      setData,
      setHashJsonField,
    }));

    jest.doMock('../lib/runtimeSignalsLoader', () => ({
      loadRuntimeSignalEvaluations,
      loadRuntimeSignalEvaluationStatsBuckets,
      loadRuntimeSignals,
    }));

    jest.doMock('@tradejs/node/cli', () => ({
      sendDocumentToTG,
      sendTextToTG,
    }));

    jest.doMock('@tradejs/node/connectors', () => ({
      DEFAULT_CONNECTOR_NAME: 'bybit',
      getConnectorCreatorByName: jest.fn(async () => async () => connector),
      resolveConnectorName: jest.fn(async () => 'bybit'),
    }));

    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'test';
    const module = await import('../scripts/signalsSummary');
    (process.env as any).NODE_ENV = prevNodeEnv;

    await module.signalsSummary();

    expect(sendTextToTG).toHaveBeenCalledTimes(2);
    expect(sendDocumentToTG).toHaveBeenCalledTimes(1);
    expect(sendDocumentToTG.mock.calls[0]?.[1]).toEqual({ userName: 'root' });
    const attachment = sendDocumentToTG.mock.calls[0]?.[0] as
      | { filename?: string; content?: string }
      | undefined;
    expect(attachment?.filename).toBe(
      'tradejs-runtime-debug-root-2023-11-16.json',
    );
    expect(typeof attachment?.content).toBe('string');
    const debugPayload = JSON.parse(String(attachment?.content));
    expect(debugPayload).toMatchObject({
      reportType: 'runtime-daily-debug',
      userName: 'root',
      counts: {
        trades: 2,
        signals: 2,
        evaluations: 1,
      },
    });
    const btcDebugTrade = debugPayload.trades.find(
      (entry: { trade?: { orderId?: string } }) =>
        entry.trade?.orderId === 'ord-1',
    );
    expect(btcDebugTrade?.redisDebug).toMatchObject({
      trade: 'users:root:runtime:trade-records:ord-1',
      activeTrade: 'users:root:runtime:active-trades:BTCUSDT',
      signal: 'store:signals:BTCUSDT:sig-1',
    });
    const signalsMessage = sendTextToTG.mock.calls[0]?.[0];
    const tradesMessage = sendTextToTG.mock.calls[1]?.[0];
    expect(typeof signalsMessage).toBe('string');
    expect(typeof tradesMessage).toBe('string');
    if (
      typeof signalsMessage !== 'string' ||
      typeof tradesMessage !== 'string'
    ) {
      throw new Error('Expected summary messages to be strings');
    }
    expect(signalsMessage).toContain('TradeJS daily summary');
    expect(signalsMessage).toContain('📡 <b>Signals</b>');
    expect(signalsMessage).toContain('💰 <b>24h PnL:</b> <b>-16.00</b>');
    expect(signalsMessage).toContain('🏆 <b>WinRate:</b> <b>0.00% (0/1)</b>');
    expect(signalsMessage).toContain(
      '↗️ <b>LONG:</b> <b>1</b>, ↘️ <b>SHORT:</b> <b>1</b>',
    );
    expect(signalsMessage).toContain('<b>TrendLine</b>\ncompleted=<b>1</b>');
    expect(signalsMessage).toContain(
      '<b>ReverseTrendLine</b>\nskipped=<b>1</b>',
    );
    expect(signalsMessage).toContain(
      '<b>ReverseTrendLine</b>\nskipped=<b>1</b>\nevaluated=<b>1</b>, signals=<b>1</b>',
    );
    expect(signalsMessage).toContain('<b>skip from AI</b>:');
    expect(signalsMessage).toContain('MIN_AI_QUALITY: <b>1</b>');
    expect(tradesMessage).toContain('TradeJS daily summary');
    expect(tradesMessage).toContain('💼 <b>Trades</b>');
    expect(tradesMessage).toContain('📎 <b>Replay debug file</b>');
    expect(tradesMessage).toContain(
      'File: <code>tradejs-runtime-debug-root-2023-11-16.json</code>',
    );
    expect(tradesMessage).toContain(
      'Inside: trades=<b>2</b>, signals=<b>2</b>, evaluations=<b>1</b>',
    );
    expect(tradesMessage).toContain(
      'Redis refs: <code>trade</code>, <code>tradeBucket</code>, <code>activeTrade</code>, <code>signal</code>, <code>evaluation</code>',
    );
    expect(tradesMessage).toContain(
      '<b>TrendLine</b>\ntotal=<b>1</b>, 🔴 (PnL <b>-12.00</b>)\n- BTCUSDT: PnL <b>-12.00</b> 🔴',
    );
    expect(tradesMessage).toContain(
      '<b>ReverseTrendLine</b>\ntotal=<b>1</b>, ❌ (PnL <b>-4.00</b>)\n- ETHUSDT: PnL <b>-4.00</b> ❌',
    );
    expect(setData).toHaveBeenCalledWith(
      redisKeys.runtimeTrade('root', 'ord-2'),
      expect.objectContaining({
        orderId: 'ord-2',
        status: 'closed',
        closedPnl: -4,
      }),
      { expire: 2_600_000 },
    );
    expect(delKey).toHaveBeenCalledWith(
      redisKeys.runtimeActiveTrade('root', 'ETHUSDT'),
    );
  });

  it('includes configured strategies with no signals or trades in the window', async () => {
    jest.resetModules();

    const now = 1_700_086_400_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const sendTextToTG = jest.fn(
      async (_message: string, _options?: unknown) => null,
    );
    const sendDocumentToTG = jest.fn(
      async (_document: unknown, _options?: unknown) => null,
    );
    const setData = jest.fn(async () => null);
    const setHashJsonField = jest.fn(async () => null);
    const delKey = jest.fn(async () => true);
    const loadRuntimeSignals = jest.fn(async () => [
      {
        signalId: 'sig-1',
        strategy: 'AdaptiveMomentumRibbon',
        symbol: 'BTCUSDT',
        interval: '15',
        direction: 'LONG',
        timestamp: now - 60_000,
        orderStatus: 'skipped',
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
        figures: {},
        indicators: {},
        additionalIndicators: {},
      },
    ]);
    const loadRuntimeSignalEvaluationStatsBuckets = jest.fn(async () => [
      {
        key: 'users:root:runtime:signal-evaluation-stats:days:2023-11-15:VolumeDivergence',
        dayKey: '2023-11-15',
        strategy: 'VolumeDivergence',
        stats: {
          evaluated: 1,
          signals: 0,
          reasonGroups: new Map([
            ['skip from core', new Map([['NO_DIVERGENCE', 1]])],
          ]),
        },
      },
    ]);
    const loadRuntimeSignalEvaluations = jest.fn(async () => []);
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const redisKeys = {
      strategies: (userName: string) => `users:${userName}:strategies`,
      runtimeTrades: (userName: string) =>
        `users:${userName}:runtime:trade-records:`,
      runtimeTrade: (userName: string, orderId: string) =>
        `users:${userName}:runtime:trade-records:${orderId}`,
      runtimeTradeBucket: (userName: string, dayKey: string) =>
        `users:${userName}:runtime:trade-records:days:${dayKey}`,
      runtimeTradeBuckets: (userName: string) =>
        `users:${userName}:runtime:trade-records:days:`,
      runtimeActiveTrade: (userName: string, symbol: string) =>
        `users:${userName}:runtime:active-trades:${symbol}`,
      runtimeActiveTrades: (userName: string) =>
        `users:${userName}:runtime:active-trades:`,
      storeSignal: (symbol: string, signalId: string) =>
        `store:signals:${symbol}:${signalId}`,
      runtimeSignalBuckets: (userName: string) =>
        `users:${userName}:runtime:signals:days:`,
      runtimeSignalEvaluation: (userName: string, evaluationId: string) =>
        `users:${userName}:runtime:signal-evaluations:${evaluationId}`,
      runtimeSignalEvaluationBucket: (
        userName: string,
        dayKey: string,
        strategyName: string,
      ) =>
        `users:${userName}:runtime:signal-evaluations:days:${dayKey}:${strategyName}`,
      runtimeSignalEvaluationBuckets: (userName: string) =>
        `users:${userName}:runtime:signal-evaluations:days:`,
      runtimeSignalEvaluationStatsBuckets: (userName: string) =>
        `users:${userName}:runtime:signal-evaluation-stats:days:`,
    };
    const strategyConfigKeys = [
      `${redisKeys.strategies('root')}:AdaptiveMomentumRibbon:config`,
      `${redisKeys.strategies('root')}:ReverseTrendLine:config`,
      `${redisKeys.strategies('root')}:TrendLine:config`,
      `${redisKeys.strategies('root')}:VolumeDivergence:config`,
    ];
    const getKeys = jest.fn(async (prefix: string) => {
      if (prefix === `${redisKeys.strategies('root')}:`) {
        return strategyConfigKeys;
      }
      if (prefix === redisKeys.runtimeTrades('root')) {
        return [];
      }
      return [];
    });
    const getData = jest.fn(async (key: string, fallback: unknown) => {
      return fallback;
    });
    const connector = {
      getOpenPositionPnl: jest.fn(async () => []),
      getClosedPnl: jest.fn(async () => []),
    };

    jest.doMock('args', () => ({
      __esModule: true,
      default: {
        option: jest.fn(),
        parse: jest.fn(() => ({
          user: 'root',
          connector: 'bybit',
          hours: 168,
          printOnly: false,
        })),
      },
    }));

    jest.doMock('@tradejs/core/constants', () => ({
      TTL_1M: 2_600_000,
    }));

    jest.doMock('@tradejs/infra/logger', () => ({
      logger,
    }));

    jest.doMock('@tradejs/infra/redis', () => ({
      delKey,
      getData,
      getKeys,
      redisKeys,
      setData,
      setHashJsonField,
    }));

    jest.doMock('../lib/runtimeSignalsLoader', () => ({
      loadRuntimeSignalEvaluations,
      loadRuntimeSignalEvaluationStatsBuckets,
      loadRuntimeSignals,
    }));

    jest.doMock('@tradejs/node/cli', () => ({
      sendDocumentToTG,
      sendTextToTG,
    }));

    jest.doMock('@tradejs/node/connectors', () => ({
      DEFAULT_CONNECTOR_NAME: 'bybit',
      getConnectorCreatorByName: jest.fn(async () => async () => connector),
      resolveConnectorName: jest.fn(async () => 'bybit'),
    }));

    const prevNodeEnv = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'test';
    const module = await import('../scripts/signalsSummary');
    (process.env as any).NODE_ENV = prevNodeEnv;

    await module.signalsSummary();

    expect(sendTextToTG).toHaveBeenCalledTimes(2);
    expect(sendDocumentToTG).toHaveBeenCalledTimes(1);
    const signalsMessage = sendTextToTG.mock.calls[0]?.[0];
    const tradesMessage = sendTextToTG.mock.calls[1]?.[0];
    expect(typeof signalsMessage).toBe('string');
    expect(typeof tradesMessage).toBe('string');
    if (
      typeof signalsMessage !== 'string' ||
      typeof tradesMessage !== 'string'
    ) {
      throw new Error('Expected summary messages to be strings');
    }

    expect(signalsMessage).toContain('TradeJS weekly summary');
    expect(signalsMessage).toContain('📡 <b>Signals</b>');
    expect(signalsMessage).toContain('Range: <b>168h</b>');
    expect(signalsMessage).toContain('💰 <b>168h PnL:</b> <b>n/a</b>');
    expect(signalsMessage).toContain('🏆 <b>WinRate:</b> <b>n/a</b>');
    expect(signalsMessage).toContain(
      '↗️ <b>LONG:</b> <b>0</b>, ↘️ <b>SHORT:</b> <b>0</b>',
    );
    expect(signalsMessage).toContain(
      '<b>AdaptiveMomentumRibbon</b>\nskipped=<b>1</b>',
    );
    expect(signalsMessage).toContain('<b>ReverseTrendLine</b>\nnone');
    expect(signalsMessage).toContain('<b>TrendLine</b>\nnone');
    expect(signalsMessage).toContain(
      '<b>VolumeDivergence</b>\nsignals=<b>0</b>',
    );
    expect(signalsMessage).toContain(
      '<b>VolumeDivergence</b>\nsignals=<b>0</b>\nevaluated=<b>1</b>, signals=<b>0</b>',
    );
    expect(signalsMessage).toContain('<b>skip from core</b>:');
    expect(signalsMessage).toContain('NO_DIVERGENCE: <b>1</b>');
    expect(tradesMessage).toContain('TradeJS weekly summary');
    expect(tradesMessage).toContain('💼 <b>Trades</b>');
    expect(tradesMessage).toContain('📎 <b>Replay debug file</b>');
    expect(tradesMessage).toContain(
      'Inside: trades=<b>0</b>, signals=<b>1</b>, evaluations=<b>0</b>',
    );
    expect(tradesMessage).toContain(
      '<b>AdaptiveMomentumRibbon</b>\ntotal=<b>0</b>',
    );
    expect(tradesMessage).toContain('<b>ReverseTrendLine</b>\ntotal=<b>0</b>');
    expect(tradesMessage).toContain('<b>TrendLine</b>\ntotal=<b>0</b>');
    expect(tradesMessage).toContain('<b>VolumeDivergence</b>\ntotal=<b>0</b>');
  });
});
