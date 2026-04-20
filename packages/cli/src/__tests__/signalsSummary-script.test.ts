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
      runtimeSignals: (userName: string) =>
        `users:${userName}:runtime:signals:`,
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
    const runtimeTradeKeys = [
      redisKeys.runtimeTrades('root') + 'ord-1',
      redisKeys.runtimeTrades('root') + 'ord-2',
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
      if (prefix === redisKeys.runtimeSignals('root')) {
        return runtimeSignalKeys;
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
      TTL_3M: 7_800_000,
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
    expect(message).toContain('TrendLine: completed=1');
    expect(message).toContain('ReverseTrendLine: skipped=1');
    expect(message).toContain(
      'TrendLine: total=1, active=1 (PnL +12.00), closed=0 (PnL n/a), totalPnL=+12.00',
    );
    expect(message).toContain(
      'ReverseTrendLine: total=1, active=0 (PnL n/a), closed=1 (PnL -4.00), totalPnL=-4.00',
    );
    expect(setData).toHaveBeenCalledWith(
      redisKeys.runtimeTrade('root', 'ord-2'),
      expect.objectContaining({
        orderId: 'ord-2',
        status: 'closed',
        closedPnl: -4,
      }),
      { expire: 7_800_000 },
    );
    expect(delKey).toHaveBeenCalledWith(
      redisKeys.runtimeActiveTrade('root', 'ETHUSDT'),
    );
  });
});
