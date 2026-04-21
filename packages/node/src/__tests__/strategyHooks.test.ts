import {
  createCloseOppositeBeforePlaceOrderHook,
  createCloseAllPositionsOnGlobalProfitHook,
  createCloseAllPositionsOnGlobalProfitBeforeSignalsHook,
  createMoveStopToBreakEvenOnBarHook,
} from '@tradejs/node/strategies';
import { closeOppositePositionsBeforeOpen } from '../strategyHooks/closeOppositePositionsBeforeOpen';

jest.mock('../strategyHooks/closeOppositePositionsBeforeOpen', () => ({
  closeOppositePositionsBeforeOpen: jest.fn(),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
  },
}));

const mockedCloseOppositePositionsBeforeOpen =
  closeOppositePositionsBeforeOpen as jest.MockedFunction<
    typeof closeOppositePositionsBeforeOpen
  >;

describe('createCloseOppositeBeforePlaceOrderHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does nothing when feature flag resolver returns false', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => false,
    });

    const connector = {} as any;
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

    expect(mockedCloseOppositePositionsBeforeOpen).not.toHaveBeenCalled();
  });

  it('closes opposite positions when feature flag resolver returns true', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => true,
    });

    const connector = {} as any;
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

    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledTimes(1);
    expect(mockedCloseOppositePositionsBeforeOpen).toHaveBeenCalledWith({
      connector,
      entryContext,
    });
  });

  it('does nothing in backtest mode', async () => {
    const hook = createCloseOppositeBeforePlaceOrderHook({
      isEnabled: () => true,
    });

    await hook({
      ctx: {
        connector: {} as any,
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

    expect(mockedCloseOppositePositionsBeforeOpen).not.toHaveBeenCalled();
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

describe('createCloseAllPositionsOnGlobalProfitHook', () => {
  const makeParams = ({
    strategyConfig = {
      MAX_LOSS_VALUE: 10,
      MAKE_ORDERS: true,
    },
    positions = [],
    env = 'LIVE',
    decision = {
      kind: 'entry',
      code: 'ENTRY_SIGNAL',
    } as any,
  }: {
    strategyConfig?: Record<string, unknown>;
    positions?: Array<Record<string, unknown>>;
    env?: string;
    decision?: any;
  } = {}) => {
    const connector = {
      getOpenPositionPnl: jest.fn(async () => positions),
      closePosition: jest.fn(async () => true),
    } as any;

    return {
      ctx: {
        connector,
        strategyName: 'TrendLine',
        userName: 'root',
        symbol: 'ETHUSDT',
        strategyConfig: strategyConfig as any,
        env,
        isConfigFromBacktest: false,
      },
      market: {
        candle: {
          close: 101,
          timestamp: 1_700_000_000_000,
        },
        btcCandle: {} as any,
      },
      decision,
      connector,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes all open positions when total unrealized pnl reaches the global threshold', async () => {
    const getActiveStrategyNames = jest.fn(async () => ['MaStrategy']);
    const getStrategyDefaultConfig = jest.fn((strategyName: string) =>
      strategyName === 'MaStrategy'
        ? ({ MAX_LOSS_VALUE: 20 } as any)
        : undefined,
    );
    const resolveStrategyConfigFn = jest.fn(async () => ({
      config: {
        MAX_LOSS_VALUE: 20,
      },
      isConfigFromBacktest: false,
    }));
    const hook = createCloseAllPositionsOnGlobalProfitHook({
      getActiveStrategyNames,
      getStrategyDefaultConfig,
      resolveStrategyConfigFn: resolveStrategyConfigFn as any,
    });
    const params = makeParams({
      positions: [
        {
          symbol: 'ETHUSDT',
          qty: 1,
          price: 100,
          currentPrice: 140,
          unrealizedPnl: 40,
          direction: 'LONG',
        },
        {
          symbol: 'BTCUSDT',
          qty: 1,
          price: 200,
          currentPrice: 230,
          unrealizedPnl: 30,
          direction: 'LONG',
        },
      ],
    });

    await expect(hook(params as any)).resolves.toEqual({
      kind: 'skip',
      code: 'GLOBAL_UNREALIZED_PNL_TARGET_REACHED_CLOSE_ALL',
    });

    expect(getActiveStrategyNames).toHaveBeenCalledTimes(1);
    expect(getStrategyDefaultConfig).toHaveBeenCalledWith('MaStrategy');
    expect(resolveStrategyConfigFn).toHaveBeenCalledWith({
      strategyName: 'MaStrategy',
      userName: 'root',
      symbol: 'ETHUSDT',
      baseConfig: {
        ENV: 'LIVE',
      },
      defaults: {
        MAX_LOSS_VALUE: 20,
      },
    });
    expect(params.connector.closePosition).toHaveBeenCalledTimes(2);
    expect(params.connector.closePosition).toHaveBeenNthCalledWith(1, {
      symbol: 'ETHUSDT',
      direction: 'LONG',
      price: 140,
      timestamp: 1_700_000_000_000,
    });
    expect(params.connector.closePosition).toHaveBeenNthCalledWith(2, {
      symbol: 'BTCUSDT',
      direction: 'LONG',
      price: 230,
      timestamp: 1_700_000_000_000,
    });
  });

  it('prefers resolved strategy config over built-in defaults when averaging MAX_LOSS_VALUE', async () => {
    const hook = createCloseAllPositionsOnGlobalProfitHook({
      getActiveStrategyNames: async () => ['MaStrategy'],
      getStrategyDefaultConfig: () => ({
        MAX_LOSS_VALUE: 20,
      }),
      resolveStrategyConfigFn: (async () => ({
        config: {
          MAX_LOSS_VALUE: 40,
        },
        isConfigFromBacktest: false,
      })) as any,
    });
    const params = makeParams({
      positions: [
        {
          symbol: 'ETHUSDT',
          qty: 1,
          price: 100,
          currentPrice: 180,
          unrealizedPnl: 80,
          direction: 'LONG',
        },
      ],
    });

    await expect(hook(params as any)).resolves.toBeUndefined();
    expect(params.connector.closePosition).not.toHaveBeenCalled();
  });

  it('does nothing when connector does not support unrealized pnl snapshots', async () => {
    const hook = createCloseAllPositionsOnGlobalProfitHook();

    await expect(
      hook({
        ...makeParams(),
        ctx: {
          ...makeParams().ctx,
          connector: {
            closePosition: jest.fn(async () => true),
          },
        },
      } as any),
    ).resolves.toBeUndefined();
  });

  it('does nothing in backtest mode', async () => {
    const hook = createCloseAllPositionsOnGlobalProfitHook({
      getActiveStrategyNames: async () => ['MaStrategy'],
      getStrategyDefaultConfig: () => ({
        MAX_LOSS_VALUE: 20,
      }),
      resolveStrategyConfigFn: (async () => ({
        config: {
          MAX_LOSS_VALUE: 20,
        },
        isConfigFromBacktest: false,
      })) as any,
    });
    const params = makeParams({
      env: 'BACKTEST',
      positions: [
        {
          symbol: 'ETHUSDT',
          qty: 1,
          price: 100,
          currentPrice: 180,
          unrealizedPnl: 80,
          direction: 'LONG',
        },
      ],
    });

    await expect(hook(params as any)).resolves.toBeUndefined();
    expect(params.connector.closePosition).not.toHaveBeenCalled();
  });
});

describe('createCloseAllPositionsOnGlobalProfitBeforeSignalsHook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes all open positions once before signals and aborts evaluation', async () => {
    const hook = createCloseAllPositionsOnGlobalProfitBeforeSignalsHook({
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
    const hook = createCloseAllPositionsOnGlobalProfitBeforeSignalsHook({
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
