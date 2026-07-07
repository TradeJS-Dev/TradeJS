jest.mock('@tradejs/core/indicators', () => {
  const actual = jest.requireActual('@tradejs/core/indicators');

  return {
    ...actual,
    createTrendlineEngine: jest.fn(),
  };
});

jest.mock('@tradejs/node/strategies', () => {
  const actual = jest.requireActual('@tradejs/node/strategies');

  return {
    ...actual,
    getStrategyMarketSnapshot: jest.fn(),
    getDirectionalTpSlPrices: jest.fn(),
    buildEntrySignalDecision: jest.fn(),
  };
});

jest.mock('../filters', () => ({
  filterByVeryVolatility: jest.fn(() => true),
  filterByVeryVolatilityCandles: jest.fn(() => true),
}));

import { createTrendlineEngine } from '@tradejs/core/indicators';
import {
  buildEntrySignalDecision,
  getDirectionalTpSlPrices,
  getStrategyMarketSnapshot,
} from '@tradejs/node/strategies';
import { filterByVeryVolatilityCandles } from '../filters';
import { createReverseTrendLineCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

const makeCandle = (
  timestamp: number,
  {
    open,
    close,
    high,
    low,
  }: { open: number; close: number; high: number; low: number },
) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open,
  close,
  high,
  low,
  volume: 100 + close,
  turnover: close * 1000,
});

const makeLine = ({
  mode,
  timestamp,
  linePrice,
  distance = 120,
  touches = 4,
}: {
  mode: 'lows' | 'highs';
  timestamp: number;
  linePrice: number;
  distance?: number;
  touches?: number;
}) => ({
  id: `${mode}-line-1`,
  mode,
  distance,
  touches: Array.from({ length: touches }, (_, index) => ({
    timestamp: timestamp - (touches - index) * 900_000,
    value: linePrice,
  })),
  points: [
    { timestamp: timestamp - 900_000, value: linePrice },
    { timestamp, value: linePrice },
  ],
});

const makeStrategyApi = () => {
  let latestMarketData: {
    timestamp: number;
    currentPrice: number;
  } | null = null;
  let currentPosition: any = null;

  return {
    skip: (code: string) => ({ kind: 'skip', code }),
    entry: async (params: any) => {
      if (!latestMarketData) {
        latestMarketData = await getStrategyMarketSnapshot({} as any);
      }

      const takeProfitPrices = Array.isArray(params.orderPlan?.takeProfits)
        ? params.orderPlan.takeProfits.map((tp: any) => Number(tp.price))
        : [];
      const takeProfitPrice =
        params.direction === 'LONG'
          ? Math.max(...takeProfitPrices)
          : Math.min(...takeProfitPrices);
      const stopLossPrice = Number(params.orderPlan?.stopLossPrice);
      const currentPrice = latestMarketData.currentPrice;
      const reward =
        params.direction === 'LONG'
          ? takeProfitPrice - currentPrice
          : currentPrice - takeProfitPrice;
      const risk =
        params.direction === 'LONG'
          ? currentPrice - stopLossPrice
          : stopLossPrice - currentPrice;

      return buildEntrySignalDecision({
        code: params.code ?? `REVERSE_TRENDLINE_${params.direction}_ENTRY`,
        entryContext: {
          strategy: 'ReverseTrendLine',
          symbol: 'TESTUSDT',
          interval: '15',
          direction: params.direction,
          timestamp: latestMarketData.timestamp,
          prices: {
            currentPrice,
            takeProfitPrice,
            stopLossPrice,
            riskRatio: risk > 0 ? reward / risk : 0,
          },
          isConfigFromBacktest: false,
        },
        figures: params.figures,
        indicators: params.indicators,
        additionalIndicators: params.additionalIndicators,
        signalId: params.signalId,
        orderPlan: params.orderPlan,
        runtime: params.runtime,
      });
    },
    exit: async (params: any) => ({
      kind: 'exit',
      code: params.code,
      closePlan: {
        direction: params.direction,
        price: params.price ?? 0,
        timestamp: params.timestamp ?? 0,
      },
    }),
    protect: (params: any) => ({
      kind: 'protect',
      code: params.code,
      protectPlan: params.protectPlan,
    }),
    getMarketData: async (params: any) => {
      const marketData = await getStrategyMarketSnapshot(params);
      latestMarketData = marketData;
      return marketData;
    },
    nextIndicators: jest.fn(),
    getCurrentPosition: jest.fn(async () => currentPosition),
    isCurrentPositionExists: jest.fn(async () => Boolean(currentPosition)),
    __setCurrentPosition: (position: any) => {
      currentPosition = position;
    },
    getDirectionalTpSlPrices: (params: any) => getDirectionalTpSlPrices(params),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: jest.fn(() => false),
      markTrade: jest.fn(),
      getLastTradeTimestamp: jest.fn(() => null),
    })),
    createStateController: createTestStateController(),
  } as any;
};

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    onBar: jest.fn(),
    next: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({
      maFast: [101],
      maSlow: [100],
      btcMaFast: [101],
      btcMaSlow: [100],
      atrPct: [0.8],
      correlation: [0.1],
    })),
    latestNumber: jest.fn(() => 0.1),
    isInitialized: jest.fn(() => true),
  }) as any;

const makeCoreParams = (overrides: Record<string, unknown> = {}) => ({
  userName: 'test',
  symbol: 'TESTUSDT',
  config: DEFAULT_CONFIG as any,
  data: [] as any,
  btcData: [] as any,
  connector: {} as any,
  strategyApi: makeStrategyApi(),
  indicatorsState: makeIndicatorsState(),
  isConfigFromBacktest: false,
  ...overrides,
});

describe('createReverseTrendLineCore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (filterByVeryVolatilityCandles as jest.Mock).mockReturnValue(true);
    (getDirectionalTpSlPrices as jest.Mock).mockReturnValue({
      stopLossPrice: 99,
      takeProfitPrice: 102.2,
      riskRatio: 2.0,
      qty: 1,
    });
    (buildEntrySignalDecision as jest.Mock).mockImplementation(
      (params: any) => ({
        kind: 'entry',
        ...params.entryContext,
        code: params.code,
        figures: params.figures,
        indicators: params.indicators,
        additionalIndicators: params.additionalIndicators,
        orderPlan: params.orderPlan,
      }),
    );
  });

  it('opens LONG on support rejection', async () => {
    const candle = makeCandle(1_700_000_000_000, {
      open: 99.9,
      close: 100.4,
      high: 100.7,
      low: 99.7,
    });
    const lowsLine = makeLine({
      mode: 'lows',
      timestamp: candle.timestamp,
      linePrice: 100,
      distance: 90,
      touches: 5,
    });

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [lowsLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [
        makeCandle(candle.timestamp - 900_000, {
          open: 100.5,
          close: 100.3,
          high: 100.7,
          low: 100.1,
        }),
        candle,
      ],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const core = await createReverseTrendLineCore(
      makeCoreParams({
        data: [candle] as any,
      }) as any,
    );

    const decision = await core(candle as any, candle as any);

    expect(decision.kind).toBe('entry');
    expect((decision as any).direction).toBe('LONG');
    expect(decision.code).toBe('REVERSE_TRENDLINE_SIGNAL');
  });

  it('opens SHORT on resistance rejection', async () => {
    const candle = makeCandle(1_700_000_000_000, {
      open: 100.1,
      close: 99.6,
      high: 100.3,
      low: 99.4,
    });
    const highsLine = makeLine({
      mode: 'highs',
      timestamp: candle.timestamp,
      linePrice: 100,
      distance: 90,
      touches: 5,
    });

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => []) })
      .mockReturnValueOnce({ next: jest.fn(() => [highsLine]) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [
        makeCandle(candle.timestamp - 900_000, {
          open: 99.4,
          close: 99.6,
          high: 99.8,
          low: 99.2,
        }),
        candle,
      ],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const indicatorsState = makeIndicatorsState();
    indicatorsState.snapshot.mockReturnValue({
      maFast: [99],
      maSlow: [100],
      btcMaFast: [99],
      btcMaSlow: [100],
      atrPct: [0.8],
      correlation: [0.1],
    });

    const core = await createReverseTrendLineCore(
      makeCoreParams({
        data: [candle] as any,
        indicatorsState,
      }) as any,
    );

    const decision = await core(candle as any, candle as any);

    expect(decision.kind).toBe('entry');
    expect((decision as any).direction).toBe('SHORT');
  });

  it('skips when reaction is not confirmed', async () => {
    const candle = makeCandle(1_700_000_000_000, {
      open: 100.05,
      close: 100.06,
      high: 100.2,
      low: 99.95,
    });
    const lowsLine = makeLine({
      mode: 'lows',
      timestamp: candle.timestamp,
      linePrice: 100,
    });

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [lowsLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [
        makeCandle(candle.timestamp - 900_000, {
          open: 100.4,
          close: 100.2,
          high: 100.6,
          low: 100.1,
        }),
        candle,
      ],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const core = await createReverseTrendLineCore(
      makeCoreParams({
        data: [candle] as any,
      }) as any,
    );

    const decision = await core(candle as any, candle as any);

    expect(decision).toEqual({
      kind: 'skip',
      code: 'REVERSE_TRENDLINE_TIMING:WAIT_REACTION_CONFIRMATION',
    });
  });

  it('exits on failed bounce break through the line', async () => {
    const candle = makeCandle(1_700_000_000_000, {
      open: 99.7,
      close: 99.4,
      high: 99.8,
      low: 99.2,
    });
    const lowsLine = makeLine({
      mode: 'lows',
      timestamp: candle.timestamp,
      linePrice: 100,
    });

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [lowsLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => []) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [
        makeCandle(candle.timestamp - 900_000, {
          open: 100.4,
          close: 100.2,
          high: 100.6,
          low: 100.1,
        }),
        candle,
      ],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const strategyApi = makeStrategyApi();
    strategyApi.__setCurrentPosition({
      direction: 'LONG',
      price: 100.2,
      qty: 1,
      slPrice: 99,
    });

    const core = await createReverseTrendLineCore(
      makeCoreParams({
        data: [candle] as any,
        strategyApi,
      }) as any,
    );

    const decision = await core(candle as any, candle as any);

    expect(decision.kind).toBe('exit');
    expect(decision.code).toBe('REVERSE_TRENDLINE_FAILED_BOUNCE_EXIT');
  });

  it('prefers the touched candidate line when both directions are available', async () => {
    const candle = makeCandle(1_700_000_000_000, {
      open: 100.15,
      close: 99.52,
      high: 100.32,
      low: 99.42,
    });
    const lowsLine = makeLine({
      mode: 'lows',
      timestamp: candle.timestamp,
      linePrice: 99.1,
      distance: 140,
      touches: 5,
    });
    const highsLine = makeLine({
      mode: 'highs',
      timestamp: candle.timestamp,
      linePrice: 100,
      distance: 105,
      touches: 5,
    });

    (createTrendlineEngine as jest.Mock)
      .mockReturnValueOnce({ next: jest.fn(() => [lowsLine]) })
      .mockReturnValueOnce({ next: jest.fn(() => [highsLine]) });
    (getStrategyMarketSnapshot as jest.Mock).mockResolvedValue({
      fullData: [
        makeCandle(candle.timestamp - 900_000, {
          open: 99.8,
          close: 99.9,
          high: 100.1,
          low: 99.7,
        }),
        candle,
      ],
      lastCandle: candle,
      timestamp: candle.timestamp,
      currentPrice: candle.close,
    });

    const indicatorsState = makeIndicatorsState();
    indicatorsState.snapshot.mockReturnValue({
      maFast: [99.7],
      maSlow: [100],
      btcMaFast: [99.7],
      btcMaSlow: [100],
      atrPct: [0.8],
      correlation: [0.1],
    });

    const core = await createReverseTrendLineCore(
      makeCoreParams({
        data: [candle] as any,
        indicatorsState,
      }) as any,
    );

    const decision = await core(candle as any, candle as any);

    expect(decision.kind).toBe('entry');
    expect((decision as any).direction).toBe('SHORT');
    expect((decision as any).figures.lines[0].id).toBe(highsLine.id);
  });
});
