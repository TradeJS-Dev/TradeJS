/** @jest-environment node */

import { logger } from '@tradejs/infra/logger';
import { createAdaptiveMomentumRibbonCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';
import { evaluateAdaptiveMomentumRibbon } from '../engine';

jest.mock('../engine', () => ({
  evaluateAdaptiveMomentumRibbon: jest.fn(),
}));

const makeCandle = (timestamp: number, open: number, close: number) => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open,
  close,
  high: Math.max(open, close) + 0.8,
  low: Math.min(open, close) - 0.8,
  volume: 1_000,
  turnover: close * 1_000,
});

const makeCandles = ({ bullishLast }: { bullishLast: boolean }) => {
  const start = 1_700_000_000_000;
  return Array.from({ length: 90 }, (_, index) => {
    const base = 100 + Math.sin(index / 5) * 2;
    const isLast = index === 89;
    const open = isLast ? (bullishLast ? base - 0.5 : base + 0.5) : base - 0.1;
    const close = isLast ? (bullishLast ? base + 0.5 : base - 0.5) : base + 0.1;
    return makeCandle(start + index * 60_000, open, close);
  });
};

const makeStrategyApi = (marketData: any, currentPosition: any = null) =>
  ({
    skip: (code: string) => ({ kind: 'skip', code }),
    getMarketData: jest.fn(async () => marketData),
    getCurrentPosition: jest.fn(async () => currentPosition),
    isCurrentPositionExists: jest.fn(async () =>
      Boolean(currentPosition && currentPosition.qty > 0),
    ),
    getDirectionalTpSlPrices: jest.fn(({ price, direction }) => ({
      stopLossPrice: direction === 'LONG' ? price * 0.99 : price * 1.01,
      takeProfitPrice: direction === 'LONG' ? price * 1.02 : price * 0.98,
      riskRatio: 2.1,
      qty: 1,
    })),
    createLastTradeController: jest.fn(() => ({
      isInCooldown: () => false,
      markTrade: jest.fn(),
      getLastTradeTimestamp: () => null,
    })),
    entry: (params: any) => {
      const takeProfitPrices = Array.isArray(params.orderPlan?.takeProfits)
        ? params.orderPlan.takeProfits.map((tp: any) => Number(tp.price))
        : [];
      const takeProfitPrice =
        params.direction === 'LONG'
          ? Math.max(...takeProfitPrices)
          : Math.min(...takeProfitPrices);
      const stopLossPrice = Number(params.orderPlan?.stopLossPrice);
      const currentPrice = Number(marketData.currentPrice);
      const reward =
        params.direction === 'LONG'
          ? takeProfitPrice - currentPrice
          : currentPrice - takeProfitPrice;
      const risk =
        params.direction === 'LONG'
          ? currentPrice - stopLossPrice
          : stopLossPrice - currentPrice;
      const prices = {
        currentPrice,
        takeProfitPrice,
        stopLossPrice,
        riskRatio: risk > 0 ? reward / risk : 0,
      };

      return {
        kind: 'entry',
        code:
          params.code ?? `ADAPTIVE_MOMENTUM_RIBBON_${params.direction}_ENTRY`,
        entryContext: {
          strategy: 'AdaptiveMomentumRibbon',
          symbol: 'TESTUSDT',
          interval: '15',
          direction: params.direction,
          timestamp: marketData.timestamp,
          prices,
          isConfigFromBacktest: false,
        },
        orderPlan: params.orderPlan,
        runtime: params.runtime,
        signal: {
          signalId: params.signalId ?? 'amr-test-signal',
          strategy: 'AdaptiveMomentumRibbon',
          symbol: 'TESTUSDT',
          interval: '15',
          direction: params.direction,
          timestamp: marketData.timestamp,
          figures: params.figures ?? {},
          prices,
          indicators: params.indicators ?? {},
          additionalIndicators: params.additionalIndicators,
          isConfigFromBacktest: false,
        },
      };
    },
  }) as any;

const makeIndicatorsState = () =>
  ({
    setCurrentBar: jest.fn(),
    next: jest.fn(),
    onBar: jest.fn(),
    ensureInitializedWithCurrentBar: jest.fn(),
    snapshot: jest.fn(() => ({ correlation: [0.1] })),
    latestNumber: jest.fn(() => 0.1),
    isInitialized: jest.fn(() => true),
  }) as any;

const mockedEvaluateAdaptiveMomentumRibbon =
  evaluateAdaptiveMomentumRibbon as jest.MockedFunction<
    typeof evaluateAdaptiveMomentumRibbon
  >;

const makeEvaluation = (
  snapshotOverrides: Record<string, unknown> = {},
  plotSeriesOverrides: Record<string, any> = {},
) => ({
  snapshot: {
    entryLong: false,
    entryShort: false,
    invalidated: false,
    activeBuy: false,
    activeSell: false,
    signalOsc: 0,
    kcMidline: 100,
    kcUpper: 101,
    kcLower: 99,
    invalidationLevel: 98,
    lineValues: {
      kcMidline: 100,
      kcUpper: 101,
      kcLower: 99,
      invalidationLevel: 98,
    },
    ...snapshotOverrides,
  },
  plotSeries: {
    kcMidline: [{ time: 1_700_000_000_000, value: 100 }],
    kcUpper: [{ time: 1_700_000_000_000, value: 101 }],
    kcLower: [{ time: 1_700_000_000_000, value: 99 }],
    invalidationLevel: [{ time: 1_700_000_000_000, value: 98 }],
    ...plotSeriesOverrides,
  },
});

describe('createAdaptiveMomentumRibbonCore', () => {
  beforeEach(() => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReset();
  });

  const makeRuntime = async ({
    configOverrides = {},
    currentPosition = null,
    candles = makeCandles({ bullishLast: true }),
    marketDataOverrides = {},
    directionalTpSlPrices,
  }: {
    configOverrides?: Record<string, unknown>;
    currentPosition?: any;
    candles?: ReturnType<typeof makeCandles>;
    marketDataOverrides?: Record<string, unknown>;
    directionalTpSlPrices?: (params: any) => any;
  } = {}) => {
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
      ...marketDataOverrides,
    };

    const strategyApi = makeStrategyApi(marketData, currentPosition);
    if (directionalTpSlPrices) {
      strategyApi.getDirectionalTpSlPrices.mockImplementation(
        directionalTpSlPrices,
      );
    }

    const core = await createAdaptiveMomentumRibbonCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
        ...configOverrides,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      loadPineScriptFile: jest.fn(() => 'mock-pine-script'),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    return { core, candles, marketData, strategyApi };
  };

  it('returns entry decision for bullish AMR signal', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        entryLong: true,
        activeBuy: true,
        signalOsc: 0.6,
        kcMidline: 101,
        kcUpper: 102,
        kcLower: 100,
        invalidationLevel: 99,
        lineValues: {
          kcMidline: 101,
          kcUpper: 102,
          kcLower: 100,
          invalidationLevel: 99,
        },
      }),
    );

    const candles = makeCandles({ bullishLast: true });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };
    const strategyApi = makeStrategyApi(marketData);

    const core = await createAdaptiveMomentumRibbonCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      loadPineScriptFile: jest.fn(() => 'mock-pine-script'),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision.kind).toBe('entry');
    if (decision.kind !== 'entry') {
      return;
    }

    expect(decision.entryContext.direction).toBe('LONG');
    expect(decision.code).toBe('AMR_ENTRY_LONG');
    expect(decision.orderPlan.qty).toBe(1);
    expect(decision.orderPlan.stopLossPrice).toBeCloseTo(
      marketData.currentPrice * 0.99,
    );
    expect(strategyApi.getDirectionalTpSlPrices).toHaveBeenCalledWith(
      expect.objectContaining({
        price: marketData.currentPrice,
        direction: 'LONG',
        takeProfitDelta: 2,
        stopLossDelta: 1,
        unit: 'percent',
        maxLossValue: 10,
        feePercent: 0.005,
      }),
    );
    expect(decision.signal?.additionalIndicators).toEqual(
      expect.objectContaining({
        amrSignalTiming: expect.objectContaining({
          entryTiming: 'zero_cross',
          waitClose: true,
          lookbackBars: 200,
        }),
        amrConfigSnapshot: expect.objectContaining({
          momentumPeriod: 32,
          butterworthSmoothing: 4,
          minSignalOscAbs: 0.55,
          requireKcBias: true,
          minBarsBetweenSignals: 12,
          kcLength: 20,
          atrLength: 14,
          atrMultiplier: 2,
        }),
      }),
    );
    expect(decision.signal?.figures?.lines?.length ?? 0).toBeGreaterThan(0);
  });

  it('returns exit decision when opposite AMR signal appears on open position', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        entryShort: true,
        activeSell: true,
        signalOsc: -0.6,
        kcMidline: 99,
        kcUpper: 100,
        kcLower: 98,
        invalidationLevel: 101,
      }),
    );

    const candles = makeCandles({ bullishLast: false });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };

    const core = await createAdaptiveMomentumRibbonCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      loadPineScriptFile: jest.fn(() => 'mock-pine-script'),
      strategyApi: makeStrategyApi(marketData, {
        direction: 'LONG',
        qty: 1,
      }),
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'exit',
      code: 'CLOSE_BY_AMR_SIGNAL',
      closePlan: {
        price: marketData.currentPrice,
        timestamp: marketData.timestamp,
        direction: 'LONG',
      },
    });
  });

  it('returns exit decision by invalidation on open position', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        invalidated: true,
        activeBuy: true,
        signalOsc: 0.1,
        kcMidline: 100,
        kcUpper: 101,
        kcLower: 99,
        invalidationLevel: 98,
      }),
    );

    const candles = makeCandles({ bullishLast: true });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };

    const core = await createAdaptiveMomentumRibbonCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      loadPineScriptFile: jest.fn(() => 'mock-pine-script'),
      strategyApi: makeStrategyApi(marketData, {
        direction: 'LONG',
        qty: 1,
      }),
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'exit',
      code: 'CLOSE_BY_AMR_INVALIDATION',
      closePlan: {
        price: marketData.currentPrice,
        timestamp: marketData.timestamp,
        direction: 'LONG',
      },
    });
  });

  it('returns skip NO_SIGNAL when AMR has no entry signal', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(makeEvaluation());

    const candles = makeCandles({ bullishLast: true });
    const marketData = {
      fullData: candles,
      timestamp: candles[candles.length - 1].timestamp,
      currentPrice: candles[candles.length - 1].close,
    };

    const core = await createAdaptiveMomentumRibbonCore({
      userName: 'root',
      symbol: 'TESTUSDT',
      config: {
        ...DEFAULT_CONFIG,
      } as any,
      isConfigFromBacktest: false,
      connector: {} as any,
      data: candles.slice(0, -1),
      btcData: candles.slice(0, -1),
      loadPineScriptFile: jest.fn(() => 'mock-pine-script'),
      strategyApi: makeStrategyApi(marketData),
      indicatorsState: makeIndicatorsState(),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );
    expect(decision).toEqual({
      kind: 'skip',
      code: 'NO_SIGNAL',
    });
  });

  it('returns WAIT_DATA when market data is not enough', async () => {
    const shortCandles = makeCandles({ bullishLast: true }).slice(0, 1);
    const { core } = await makeRuntime({
      candles: shortCandles,
      marketDataOverrides: {
        fullData: shortCandles,
        timestamp: shortCandles[0].timestamp,
        currentPrice: shortCandles[0].close,
      },
    });

    const decision = await core(shortCandles[0], shortCandles[0]);
    expect(decision).toEqual({
      kind: 'skip',
      code: 'WAIT_DATA',
    });
    expect(mockedEvaluateAdaptiveMomentumRibbon).not.toHaveBeenCalled();
  });

  it('uses full candles when lookback<=0 and normalizes invalid line plots config', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(makeEvaluation());

    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({
      candles,
      configOverrides: {
        AMR_LOOKBACK_BARS: 0,
        AMR_LINE_PLOTS: 'not-an-array',
      },
    });

    await core(candles[candles.length - 1], candles[candles.length - 1]);

    expect(mockedEvaluateAdaptiveMomentumRibbon).toHaveBeenCalledWith(
      expect.objectContaining({
        candles,
        linePlots: [],
      }),
    );
  });

  it('returns AMR_EVALUATION_FAILED when evaluator throws and logs warning', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockImplementationOnce(() => {
      throw new Error('evaluation-failed');
    });
    const warnSpy = jest
      .spyOn(logger, 'warn')
      .mockImplementation(() => logger as any);

    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({ candles });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'skip',
      code: 'AMR_EVALUATION_FAILED',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'AdaptiveMomentumRibbon evaluation failed for %s: %s',
      'TESTUSDT',
      'Error: evaluation-failed',
    );
    warnSpy.mockRestore();
  });

  it('returns AMR_SIGNAL_CONFLICT when both entry flags are true', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        entryLong: true,
        entryShort: true,
      }),
    );

    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({ candles });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'skip',
      code: 'AMR_SIGNAL_CONFLICT',
    });
  });

  it('returns POSITION_HELD when position exists with no opposite/invalidation signal', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        entryLong: true,
        activeBuy: true,
      }),
    );

    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({
      candles,
      currentPosition: {
        direction: 'LONG',
        qty: 1,
      },
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'skip',
      code: 'POSITION_HELD',
    });
  });

  it('returns STRATEGY_DISABLED when signaled side is disabled in config', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        entryLong: true,
        activeBuy: true,
      }),
    );

    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({
      candles,
      configOverrides: {
        LONG: {
          ...DEFAULT_CONFIG.LONG,
          enable: false,
        },
      },
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'skip',
      code: 'STRATEGY_DISABLED',
    });
  });

  it('returns INVALID_QTY when directional sizing returns non-positive quantity', async () => {
    mockedEvaluateAdaptiveMomentumRibbon.mockReturnValue(
      makeEvaluation({
        entryLong: true,
        activeBuy: true,
      }),
    );

    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({
      candles,
      directionalTpSlPrices: ({ price, direction }) => ({
        stopLossPrice: direction === 'LONG' ? price * 0.99 : price * 1.01,
        takeProfitPrice: direction === 'LONG' ? price * 1.02 : price * 0.98,
        riskRatio: 2.1,
        qty: 0,
      }),
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'skip',
      code: 'INVALID_QTY',
    });
  });
});
