import {
  createCloseOppositeBeforePlaceOrderHook,
  createCloseAllOnGlobalProfitBeforeSignalsHook,
  createMoveStopToBreakEvenOnBarHook,
} from '@tradejs/node/strategies';

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  },
}));

describe('createCloseOppositeBeforePlaceOrderHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when feature flag resolver returns false', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => false,
    });

    const connector = {
      getPositions: jest.fn(async () => []),
      closePosition: jest.fn(async () => true),
    } as any;
    const entryContext = {
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
    } as any;

    await hook({
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: {} as any,
        env: 'LIVE',
        isConfigFromBacktest: false,
      },
      market: {} as any,
      decision: {} as any,
      entry: {
        context: entryContext,
        orderPlan: {} as any,
        signal: undefined,
        runtime: {
          raw: undefined,
          resolved: {} as any,
        },
      },
      policy: {
        aiQuality: undefined,
        makeOrdersEnabled: true,
        minAiQuality: 4,
      },
    });

    expect(connector.getPositions).not.toHaveBeenCalled();
    expect(connector.closePosition).not.toHaveBeenCalled();
  });

  it('closes opposite positions when feature flag resolver returns true', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => true,
    });

    const connector = {
      getPositions: jest.fn(async () => [
        { symbol: 'BTCUSDT', qty: 1, direction: 'SHORT' },
      ]),
      closePosition: jest.fn(async () => true),
    } as any;
    const entryContext = {
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      prices: {
        currentPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        riskRatio: 2,
      },
    } as any;

    await hook({
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: {} as any,
        env: 'LIVE',
        isConfigFromBacktest: false,
      },
      market: {} as any,
      decision: {} as any,
      entry: {
        context: entryContext,
        orderPlan: {} as any,
        signal: undefined,
        runtime: {
          raw: undefined,
          resolved: {} as any,
        },
      },
      policy: {
        aiQuality: undefined,
        makeOrdersEnabled: true,
        minAiQuality: 4,
      },
    });

    expect(connector.getPositions).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      price: 100,
      timestamp: 1_700_000_000_000,
      direction: 'SHORT',
    });
  });

  it('does nothing in backtest mode', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => true,
    });
    const connector = {
      getPositions: jest.fn(async () => []),
      closePosition: jest.fn(async () => true),
    } as any;

    await hook({
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: {} as any,
        env: 'BACKTEST',
        isConfigFromBacktest: true,
      },
      market: {} as any,
      decision: {} as any,
      entry: {
        context: {
          strategy: 'TrendLine',
          symbol: 'ETHUSDT',
          interval: '15',
          direction: 'LONG',
          timestamp: 1_700_000_000_000,
          prices: {
            currentPrice: 100,
            takeProfitPrice: 110,
            stopLossPrice: 95,
            riskRatio: 2,
          },
        } as any,
        orderPlan: {} as any,
        signal: undefined,
        runtime: {
          raw: undefined,
          resolved: {} as any,
        },
      },
      policy: {
        aiQuality: undefined,
        makeOrdersEnabled: true,
        minAiQuality: 4,
      },
    });

    expect(connector.getPositions).not.toHaveBeenCalled();
    expect(connector.closePosition).not.toHaveBeenCalled();
  });
});

describe('createMoveStopToBreakEvenOnBarHook', () => {
  const makeParams = ({
    strategyConfig = {},
    position,
    currentPrice = 101,
  }: {
    strategyConfig?: Record<string, unknown>;
    position?: Record<string, unknown> | null;
    currentPrice?: number;
  } = {}) => {
    const connector = {
      getPosition: jest.fn(async () => position ?? null),
    } as any;

    return {
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: strategyConfig as any,
        env: 'LIVE',
        isConfigFromBacktest: false,
      },
      market: {
        candle: {
          close: currentPrice,
        },
        btcCandle: {} as any,
      },
      connector,
    };
  };

  it('returns protect decision when favorable move reaches half-risk', async () => {
    const hook = createMoveStopToBreakEvenOnBarHook();
    const params = makeParams({
      position: {
        symbol: 'ETHUSDT',
        qty: 1,
        price: 100,
        direction: 'LONG',
        slPrice: 98,
      },
    });

    await expect(hook(params as any)).resolves.toEqual({
      kind: 'protect',
      code: 'TRENDLINE_MOVE_STOP_TO_BREAK_EVEN',
      protectPlan: {
        direction: 'LONG',
        stopLossPrice: 100,
      },
    });
    expect(params.connector.getPosition).toHaveBeenCalledWith('ETHUSDT');
  });

  it('moves stop beyond entry by configured share of take-profit distance', async () => {
    const hook = createMoveStopToBreakEvenOnBarHook({
      stopProfitMultiplier: 0.2,
    });
    const params = makeParams({
      position: {
        symbol: 'ETHUSDT',
        qty: 1,
        price: 100,
        direction: 'LONG',
        slPrice: 98,
        signal: {
          prices: {
            takeProfitPrice: 110,
          },
        },
      },
    });

    await expect(hook(params as any)).resolves.toEqual({
      kind: 'protect',
      code: 'TRENDLINE_MOVE_STOP_TO_BREAK_EVEN',
      protectPlan: {
        direction: 'LONG',
        stopLossPrice: 102,
      },
    });
  });

  it('falls back to signal stop price when position stop loss is missing', async () => {
    const hook = createMoveStopToBreakEvenOnBarHook();

    await expect(
      hook(
        makeParams({
          position: {
            symbol: 'ETHUSDT',
            qty: 1,
            price: 100,
            direction: 'LONG',
            signal: {
              prices: {
                stopLossPrice: 98,
              },
            },
          },
        }) as any,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'protect',
        code: 'TRENDLINE_MOVE_STOP_TO_BREAK_EVEN',
      }),
    );
  });

  it('falls back to direction config SL when position stop loss is unavailable', async () => {
    const hook = createMoveStopToBreakEvenOnBarHook();

    await expect(
      hook(
        makeParams({
          strategyConfig: {
            HIGHS: {
              direction: 'LONG',
              SL: 2,
            },
            LOWS: {
              direction: 'SHORT',
              SL: 1.3,
            },
          },
          position: {
            symbol: 'ETHUSDT',
            qty: 1,
            price: 100,
            direction: 'LONG',
          },
        }) as any,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'protect',
        code: 'TRENDLINE_MOVE_STOP_TO_BREAK_EVEN',
      }),
    );
  });

  it('falls back to entry price when take profit is unavailable', async () => {
    const hook = createMoveStopToBreakEvenOnBarHook({
      stopProfitMultiplier: 0.2,
    });

    await expect(
      hook(
        makeParams({
          position: {
            symbol: 'ETHUSDT',
            qty: 1,
            price: 100,
            direction: 'LONG',
            slPrice: 98,
          },
        }) as any,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'protect',
        protectPlan: expect.objectContaining({
          stopLossPrice: 100,
        }),
      }),
    );
  });

  it('does nothing when stop is already at break-even', async () => {
    const hook = createMoveStopToBreakEvenOnBarHook();

    await expect(
      hook(
        makeParams({
          position: {
            symbol: 'ETHUSDT',
            qty: 1,
            price: 100,
            direction: 'LONG',
            slPrice: 100,
          },
          currentPrice: 101.5,
        }) as any,
      ),
    ).resolves.toBeUndefined();
  });
});

describe('createCloseAllOnGlobalProfitBeforeSignalsHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes all open positions once before signals and aborts evaluation', async () => {
    const hook = createCloseAllOnGlobalProfitBeforeSignalsHook({
      getStrategyDefaultConfig: (strategyName: string) =>
        strategyName === 'TrendLine'
          ? ({ MAX_LOSS_VALUE: 10 } as any)
          : ({ MAX_LOSS_VALUE: 20 } as any),
    });
    const connector = {
      getOpenPositionPnl: jest.fn(async () => [
        {
          symbol: 'ETHUSDT',
          qty: 1,
          price: 100,
          currentPrice: 140,
          unrealizedPnl: 70,
          direction: 'LONG',
        },
      ]),
      closePosition: jest.fn(async () => true),
    } as any;

    await expect(
      hook({
        connector,
        connectorName: 'ByBit',
        userName: 'root',
        interval: '15',
        tickers: ['ETHUSDT'],
        runtimeStrategies: [
          {
            strategyName: 'TrendLine',
            strategyConfig: {} as any,
          },
          {
            strategyName: 'MaStrategy',
            strategyConfig: {} as any,
          },
        ],
      } as any),
    ).resolves.toEqual({
      abort: true,
      reason: 'GLOBAL_UNREALIZED_PNL_TARGET_REACHED_CLOSE_ALL',
    });

    expect(connector.closePosition).toHaveBeenCalledTimes(1);
    expect(connector.closePosition).toHaveBeenCalledWith({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      price: 140,
      timestamp: expect.any(Number),
    });
  });

  it('does nothing when unrealized pnl stays below threshold', async () => {
    const hook = createCloseAllOnGlobalProfitBeforeSignalsHook({
      getStrategyDefaultConfig: () => ({ MAX_LOSS_VALUE: 20 }) as any,
    });
    const connector = {
      getOpenPositionPnl: jest.fn(async () => [
        {
          symbol: 'ETHUSDT',
          qty: 1,
          price: 100,
          currentPrice: 110,
          unrealizedPnl: 10,
          direction: 'LONG',
        },
      ]),
      closePosition: jest.fn(async () => true),
    } as any;

    await expect(
      hook({
        connector,
        connectorName: 'ByBit',
        userName: 'root',
        interval: '15',
        tickers: ['ETHUSDT'],
        runtimeStrategies: [
          {
            strategyName: 'TrendLine',
            strategyConfig: {} as any,
          },
        ],
      } as any),
    ).resolves.toBeUndefined();

    expect(connector.closePosition).not.toHaveBeenCalled();
  });
});
