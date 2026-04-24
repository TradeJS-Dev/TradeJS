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
    const setData = jest.fn(async () => null);
    const delKey = jest.fn(async () => true);
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const redisKeys = {
      strategies: (userName: string) => `users:${userName}:strategies`,
      runtimeSignals: (userName: string) =>
        `users:${userName}:runtime:signals:`,
      runtimeSignalEvaluations: (userName: string) =>
        `users:${userName}:runtime:signal-evaluations:`,
      runtimeTrades: (userName: string) =>
        `users:${userName}:runtime:trade-records:`,
      runtimeTrade: (userName: string, orderId: string) =>
        `users:${userName}:runtime:trade-records:${orderId}`,
      runtimeActiveTrade: (userName: string, symbol: string) =>
        `users:${userName}:runtime:active-trades:${symbol}`,
    };
    const runtimeSignalKeys = [
      redisKeys.runtimeSignals('root') + 'sig-1',
      redisKeys.runtimeSignals('root') + 'sig-2',
    ];
    const runtimeSignalEvaluationKeys = [
      redisKeys.runtimeSignalEvaluations('root') + 'eval-1',
      redisKeys.runtimeSignalEvaluations('root') + 'eval-2',
    ];
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
        runtimeSignalKeys[0],
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
      ],
      [
        runtimeSignalKeys[1],
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
      ],
      [
        runtimeSignalEvaluationKeys[0],
        {
          evaluationId: 'eval-1',
          userName: 'root',
          strategy: 'TrendLine',
          symbol: 'BTCUSDT',
          interval: '15',
          timestamp: now - 60_000,
          evaluatedAt: now - 60_000,
          status: 'signal',
          signalId: 'sig-1',
          direction: 'LONG',
          orderStatus: 'completed',
        },
      ],
      [
        runtimeSignalEvaluationKeys[1],
        {
          evaluationId: 'eval-2',
          userName: 'root',
          strategy: 'ReverseTrendLine',
          symbol: 'ETHUSDT',
          interval: '15',
          timestamp: now - 120_000,
          evaluatedAt: now - 120_000,
          status: 'signal',
          signalId: 'sig-2',
          direction: 'SHORT',
          orderStatus: 'skipped',
          orderSkipReason: 'AI_QUALITY_BELOW_MIN (2 < 3)',
        },
      ],
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
      if (prefix === redisKeys.runtimeSignals('root')) {
        return runtimeSignalKeys;
      }
      if (prefix === redisKeys.runtimeSignalEvaluations('root')) {
        return runtimeSignalEvaluationKeys;
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
          unrealizedPnl: 12,
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
    }));

    jest.doMock('@tradejs/node/cli', () => ({
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

    expect(sendTextToTG).toHaveBeenCalledTimes(1);
    const firstCall = sendTextToTG.mock.calls[0];
    expect(firstCall).toBeDefined();
    const message = firstCall?.[0];
    expect(typeof message).toBe('string');
    if (typeof message !== 'string') {
      throw new Error('Expected summary message to be a string');
    }
    expect(message).toContain('TradeJS daily summary');
    expect(message).toContain('💰 <b>24h PnL:</b> <b>+8.00</b>');
    expect(message).toContain('<b>TrendLine</b>: completed=<b>1</b>');
    expect(message).toContain('<b>ReverseTrendLine</b>: skipped=<b>1</b>');
    expect(message).toContain(
      '<b>ReverseTrendLine</b>: skipped=<b>1</b>\n  • evaluated=<b>1</b>, signals=<b>1</b>',
    );
    expect(message).toContain('  • <b>skip from AI</b>:');
    expect(message).toContain('    • MIN_AI_QUALITY: <b>1</b>');
    expect(message).toContain(
      '<b>TrendLine</b>\n• total=<b>1</b>, active=<b>1</b> (PnL <b>+12.00</b>)\n• closed=<b>0</b> (PnL <b>n/a</b>), totalPnL=<b>+12.00</b>',
    );
    expect(message).toContain(
      '<b>ReverseTrendLine</b>\n• total=<b>1</b>, active=<b>0</b> (PnL <b>n/a</b>)\n• closed=<b>1</b> (PnL <b>-4.00</b>), totalPnL=<b>-4.00</b>',
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
    const setData = jest.fn(async () => null);
    const delKey = jest.fn(async () => true);
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const redisKeys = {
      strategies: (userName: string) => `users:${userName}:strategies`,
      runtimeSignals: (userName: string) =>
        `users:${userName}:runtime:signals:`,
      runtimeSignalEvaluations: (userName: string) =>
        `users:${userName}:runtime:signal-evaluations:`,
      runtimeTrades: (userName: string) =>
        `users:${userName}:runtime:trade-records:`,
      runtimeTrade: (userName: string, orderId: string) =>
        `users:${userName}:runtime:trade-records:${orderId}`,
      runtimeActiveTrade: (userName: string, symbol: string) =>
        `users:${userName}:runtime:active-trades:${symbol}`,
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
      if (prefix === redisKeys.runtimeSignals('root')) {
        return [`${redisKeys.runtimeSignals('root')}sig-1`];
      }
      if (prefix === redisKeys.runtimeSignalEvaluations('root')) {
        return [`${redisKeys.runtimeSignalEvaluations('root')}eval-1`];
      }
      if (prefix === redisKeys.runtimeTrades('root')) {
        return [];
      }
      return [];
    });
    const getData = jest.fn(async (key: string, fallback: unknown) => {
      if (key === `${redisKeys.runtimeSignals('root')}sig-1`) {
        return {
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
        };
      }
      if (key === `${redisKeys.runtimeSignalEvaluations('root')}eval-1`) {
        return {
          evaluationId: 'eval-1',
          userName: 'root',
          strategy: 'VolumeDivergence',
          symbol: 'BTCUSDT',
          interval: '15',
          timestamp: now - 60_000,
          evaluatedAt: now - 60_000,
          status: 'skip',
          reason: 'NO_DIVERGENCE',
        };
      }
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
    }));

    jest.doMock('@tradejs/node/cli', () => ({
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

    const message = sendTextToTG.mock.calls[0]?.[0];
    expect(typeof message).toBe('string');
    if (typeof message !== 'string') {
      throw new Error('Expected summary message to be a string');
    }

    expect(message).toContain('TradeJS weekly summary');
    expect(message).toContain('Range: <b>168h</b>');
    expect(message).toContain('💰 <b>168h PnL:</b> <b>n/a</b>');
    expect(message).toContain(
      '<b>AdaptiveMomentumRibbon</b>: skipped=<b>1</b>',
    );
    expect(message).toContain('<b>ReverseTrendLine</b>: none');
    expect(message).toContain('<b>TrendLine</b>: none');
    expect(message).toContain('<b>VolumeDivergence</b>: signals=<b>0</b>');
    expect(message).toContain(
      '<b>VolumeDivergence</b>: signals=<b>0</b>\n  • evaluated=<b>1</b>, signals=<b>0</b>',
    );
    expect(message).toContain('  • <b>skip from core</b>:');
    expect(message).toContain('    • NO_DIVERGENCE: <b>1</b>');
    expect(message).toContain('<b>AdaptiveMomentumRibbon</b>: total=<b>0</b>');
    expect(message).toContain('<b>ReverseTrendLine</b>: total=<b>0</b>');
    expect(message).toContain('<b>TrendLine</b>: total=<b>0</b>');
    expect(message).toContain('<b>VolumeDivergence</b>: total=<b>0</b>');
  });
});
