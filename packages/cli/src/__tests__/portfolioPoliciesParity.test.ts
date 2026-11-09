import type {
  Connector,
  PortfolioPolicyConfig,
  Signal,
  RuntimeTradeRecord,
} from '@tradejs/types';
import { createPortfolioReplayConnector } from '../lib/replay/portfolioReplayConnector';
import { createStrategyRuntime } from '@tradejs/node/strategies';
const mockBeforeClose = jest.fn();
const mockProjectHooks: { beforeClosePosition?: typeof mockBeforeClose } = {};
const mockTrades = new Map<string, Partial<RuntimeTradeRecord>>();
const mockState = new Map<string, string>();
jest.mock('../../../node/src/runtimeJournal', () => ({
  ...jest.requireActual('../../../node/src/runtimeJournal'),
  getActiveRuntimeTrade: async ({ symbol }: { symbol: string }) =>
    mockTrades.get(symbol) ?? null,
  recordRuntimeTradeOpen: async () => undefined,
  recordRuntimeTradeIncrease: async () => undefined,
  markRuntimeTradeClosed: async ({ symbol }: { symbol: string }) => {
    mockTrades.delete(symbol);
    return null;
  },
}));
jest.mock('@tradejs/infra/redis', () => ({
  ...jest.requireActual('@tradejs/infra/redis'),
  portfolioStateStorage: {
    read: async (key: string) => mockState.get(key) ?? null,
    compare: async (key: string, previous: string | null, next: string) => {
      if ((mockState.get(key) ?? null) !== previous) return false;
      mockState.set(key, next);
      return true;
    },
  },
}));
jest.mock('../../../node/src/tradejsConfig', () => ({
  ...jest.requireActual('../../../node/src/tradejsConfig'),
  loadTradejsConfig: async () => ({ hooks: mockProjectHooks }),
}));
beforeEach(() =>
  jest.replaceProperty(process, 'env', {
    ...process.env,
    BINANCE_MARKET_CONTEXT_ENABLED: 'false',
    COINMARKETCAP_CONTEXT_ENABLED: 'false',
    DERIVATIVES_CONTEXT_ENABLED: 'false',
    HYPERLIQUID_WHALE_CONTEXT_ENABLED: 'false',
  }),
);
afterEach(() => jest.restoreAllMocks());
const policy: PortfolioPolicyConfig = {
  id: 'parity',
  scope: 'strategy',
  riskUnit: 10,
  observationIntervalMs: 100,
  maxPriceAgeMs: 100,
  maxPositions: 2,
  closeOppositeOnFill: true,
  profitExit: { scope: 'basket', multiple: 2 },
};
const signal = (
  id: string,
  direction: 'LONG' | 'SHORT',
  timestamp: number,
): Signal => ({
  signalId: id,
  orderId: id,
  strategy: 'Fixture',
  symbol: `${id}USDT`,
  direction,
  interval: '1',
  timestamp,
  prices: {
    currentPrice: 100,
    stopLossPrice: direction === 'LONG' ? 50 : 150,
    takeProfitPrice: direction === 'LONG' ? 200 : 10,
    riskRatio: 2,
  },
  figures: {},
  indicators: {},
});
async function trace(
  live: boolean,
  options: {
    exitScope?: 'position' | 'basket';
    nativeTp?: boolean;
    disableBeforeExit?: boolean;
    closeGate?: 'manifest' | 'project' | 'throw' | 'opposite';
  } = {},
) {
  mockBeforeClose.mockReset();
  delete mockProjectHooks.beforeClosePosition;
  if (options.closeGate) {
    mockBeforeClose.mockImplementation(async ({ decision }) => {
      if (
        decision.code === 'PORTFOLIO_OPPOSITE_FILL' &&
        options.closeGate !== 'opposite'
      )
        return;
      if (options.closeGate === 'throw')
        throw new Error('close approval unavailable');
      return { allow: false, reason: 'fixture veto' };
    });
    if (options.closeGate === 'project')
      mockProjectHooks.beforeClosePosition = mockBeforeClose;
  }
  mockTrades.clear();
  mockState.clear();
  let now = 1000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const simulator = createPortfolioReplayConnector({
    getTickers: async () => [],
    kline: jest.fn(),
  } as unknown as Connector);
  const connector: Connector = live
    ? {
        ...simulator,
        getPortfolioObservation: undefined,
        getOpenPositionPnl: async () =>
          (await simulator.getOpenPositionPnl!()).map((p) => ({
            ...p,
            observedAt: now,
          })),
        getEntryExecutions: async () => [],
        getEntryOrderObservation: async ({ orderId }) =>
          facts.get(orderId) ?? null,
      }
    : simulator;
  const facts = new Map<
    string,
    { id: string; status: 'filled'; filledQty: number; positionId: string }
  >();
  if (live) {
    const place = simulator.placeOrder;
    connector.placeOrder = async (order) => {
      const placed = await place(order);
      if (placed && order.orderId) {
        const p = await simulator.getPosition(order.symbol);
        mockTrades.set(order.symbol, {
          orderId: order.orderId,
          strategy: order.signal?.strategy,
          direction: order.direction,
          qty: p!.qty,
          entryPrice: p!.price,
        });
        facts.set(order.orderId, {
          id: order.orderId,
          status: 'filled',
          filledQty: p!.qty,
          positionId: order.orderId,
        });
      }
      return placed;
    };
  }
  let currentDecision: import('@tradejs/types').StrategyDecision = {
    kind: 'skip',
    code: 'NO_SIGNAL',
  };
  const creator = createStrategyRuntime({
    strategyName: 'Fixture',
    defaults: {},
    manifest: {
      name: 'Fixture',
      hooks:
        options.closeGate && options.closeGate !== 'project'
          ? { beforeClosePosition: mockBeforeClose }
          : {},
    },
    createCore: async () => async () => currentDecision,
  });
  const config = {
    ENV: live ? 'LIVE' : 'BACKTEST',
    MAKE_ORDERS: true,
    BACKTEST_ENTRY_DELAY_BARS: 0,
    INTERVAL: '1' as const,

    PORTFOLIO_POLICY: {
      ...policy,
      profitExit: { scope: options.exitScope ?? 'basket', multiple: 2 },
    },
  };
  const createRunner = (symbol: string) =>
    creator({
      config,
      runtimeConfigSnapshot: { userConfig: config },
      connector,
      connectorName: 'bybit',
      symbol,
      userName: 'fixture',
      accountId: 'account',
      deploymentId: 'test',
      data: [],
      btcData: [],
    });
  const market = () => ({
    timestamp: now,
    dt: new Date(now).toISOString(),
    turnover: 100,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
  });
  const contexts: unknown[] = [];
  async function enter(id: string, direction: 'LONG' | 'SHORT') {
    const s = signal(id, direction, now);
    if (options.nativeTp && id === 'B') s.prices.takeProfitPrice = 110;

    const decision = {
      kind: 'entry' as const,
      code: 'ENTRY',
      runtime: { ai: { enabled: false }, ml: { enabled: false } },
      entryContext: {
        strategy: s.strategy,
        symbol: s.symbol,
        interval: s.interval,
        direction,
        timestamp: now,
        prices: s.prices,
        isConfigFromBacktest: false,
      },
      orderPlan: {
        qty: 1,
        stopLossPrice: s.prices.stopLossPrice,
        takeProfits: [{ price: s.prices.takeProfitPrice, rate: 1 }],
      },
      signal: s,
    };
    currentDecision = decision;
    const runner = await createRunner(s.symbol);
    await runner(market(), market());
    contexts.push(s.additionalIndicators?.portfolioContext);
    return s;
  }
  try {
    await enter('A', 'SHORT');
    await enter('B', 'LONG');
    if (options.closeGate === 'opposite') {
      expect((await simulator.getPositions()).map((p) => p.symbol)).toEqual([
        'AUSDT',
        'BUSDT',
      ]);
      expect(mockBeforeClose).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.objectContaining({ symbol: 'AUSDT' }),
          decision: expect.objectContaining({
            code: 'PORTFOLIO_OPPOSITE_FILL',
          }),
        }),
      );
      return { contexts, orders: [] };
    }
    expect((await simulator.getPositions()).map((p) => p.symbol)).toEqual([
      'BUSDT',
    ]);
    expect((await enter('blocked', 'LONG')).orderFailureReason).toBe(
      'PORTFOLIO_CLOSING',
    );
    now = 1100;
    await enter('C', 'LONG');
    expect((await enter('D', 'LONG')).orderFailureReason).toBe(
      'PORTFOLIO_POSITION_LIMIT',
    );
    now = 1200;
    for (const [symbol, close] of [
      ['BUSDT', 140],
      ['CUSDT', 90],
    ] as const)
      await simulator.advanceMarket({
        symbol,
        candle: {
          timestamp: now,
          turnover: close,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1,
        },
      });
    if (options.disableBeforeExit) config.MAKE_ORDERS = false;
    currentDecision = { kind: 'skip', code: 'NO_SIGNAL' };
    const observer = await createRunner('OBSERVERUSDT');
    await observer(market(), market());
    const remaining = (await simulator.getPositions()).map((p) => p.symbol);
    expect(remaining).toEqual(
      options.disableBeforeExit || options.closeGate
        ? ['BUSDT', 'CUSDT']
        : options.nativeTp || options.exitScope === 'position'
          ? ['CUSDT']
          : [],
    );
    if (options.closeGate) {
      const profitCalls = mockBeforeClose.mock.calls.filter(([params]) =>
        params.decision.code.startsWith('PORTFOLIO_PROFIT'),
      );
      expect(profitCalls.map(([params]) => params.ctx.symbol).sort()).toEqual([
        'BUSDT',
        'CUSDT',
      ]);
      expect(
        profitCalls.every(([params]) => params.ctx.strategyName === 'Fixture'),
      ).toBe(true);
    }
    return {
      contexts,
      orders: simulator.getReplayArtifacts().orderLog.map((o) => ({
        symbol: o.symbol,
        type: o.type,
        price: o.price,
        timestamp: o.timestamp,
        profit: o.profit,
      })),
    };
  } finally {
    clock.mockRestore();
  }
}
test('runtime exchange observations and shared replay yield identical admissions, exits, PnL and pre-entry contexts', async () => {
  const replay = await trace(false);
  const runtime = await trace(true);
  expect(runtime).toEqual(replay);
  expect(replay.orders).toHaveLength(6);
});

it.each([
  { exitScope: 'position' as const },
  { nativeTp: true },
  { disableBeforeExit: true },
])(
  'matches runtime/replay for individual exit, native TP priority or disabled execution: %j',
  async (options) => {
    expect(await trace(true, options)).toEqual(await trace(false, options));
  },
);

test('delayed entries share capacity at actual submission and preserve the signal-time snapshot', async () => {
  const connector = createPortfolioReplayConnector({
    getTickers: async () => [],
    kline: jest.fn(),
  } as unknown as Connector);
  const config = {
    ENV: 'BACKTEST',
    MAKE_ORDERS: true,
    INTERVAL: '1' as const,
    BACKTEST_ENTRY_DELAY_BARS: 1,
    PORTFOLIO_POLICY: {
      ...policy,
      maxPositions: 1,
      profitExit: undefined,
      closeOppositeOnFill: false,
    },
  };
  const signals = [signal('X', 'LONG', 1000), signal('Y', 'LONG', 1000)];
  const runners = await Promise.all(
    signals.map((s) =>
      createStrategyRuntime({
        strategyName: 'Fixture',
        defaults: {},
        createCore: async () => async () => ({
          kind: 'entry',
          code: 'ENTRY',
          runtime: { ai: { enabled: false }, ml: { enabled: false } },
          entryContext: {
            strategy: s.strategy,
            symbol: s.symbol,
            interval: s.interval,
            direction: s.direction,
            timestamp: s.timestamp,
            prices: s.prices,
            isConfigFromBacktest: false,
          },
          orderPlan: {
            qty: 1,
            stopLossPrice: 50,
            takeProfits: [{ price: 200, rate: 1 }],
          },
          signal: s,
        }),
      })({
        config,
        connector,
        connectorName: 'bybit',
        symbol: s.symbol,
        userName: 'test',
        data: [],
        btcData: [],
      }),
    ),
  );
  const candle = (timestamp: number) => ({
    timestamp,
    dt: new Date(timestamp).toISOString(),
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1,
    turnover: 100,
  });
  for (const runner of runners) await runner(candle(1000), candle(1000));
  expect(await connector.getPositions()).toEqual([]);
  const frozen = structuredClone(
    signals[1].additionalIndicators?.portfolioContext,
  );
  for (const s of signals)
    await connector.advanceMarket({ symbol: s.symbol, candle: candle(61000) });
  for (const runner of runners) await runner(candle(61000), candle(61000));
  expect((await connector.getPositions()).map((p) => p.symbol)).toEqual([
    'XUSDT',
  ]);
  expect(signals[1].orderFailureReason).toBe('PORTFOLIO_POSITION_LIMIT');
  expect(signals[1].additionalIndicators?.portfolioContext).toEqual(frozen);
});

it.each(['manifest', 'project', 'throw', 'opposite'] as const)(
  'portfolio exits respect %s close gate for the position owner in runtime and replay',
  async (closeGate) => {
    expect(await trace(true, { closeGate })).toEqual(
      await trace(false, { closeGate }),
    );
  },
);
