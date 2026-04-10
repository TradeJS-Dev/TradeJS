/** @jest-environment node */

import { runPineScript } from '@tradejs/node/pine';
import { logger } from '@tradejs/infra/logger';
import { createAdaptiveMomentumRibbonCore } from '../core';
import { config as DEFAULT_CONFIG } from '../config';

jest.mock('@tradejs/node/pine', () => {
  const actual = jest.requireActual('@tradejs/node/pine');
  return {
    ...actual,
    runPineScript: jest.fn(),
  };
});

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
  const candles = Array.from({ length: 90 }, (_, index) => {
    const base = 100 + Math.sin(index / 5) * 2;
    const isLast = index === 89;
    const open = isLast ? (bullishLast ? base - 0.5 : base + 0.5) : base - 0.1;
    const close = isLast ? (bullishLast ? base + 0.5 : base - 0.5) : base + 0.1;
    return makeCandle(start + index * 60_000, open, close);
  });
  return candles;
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

const mockedRunPineScript = runPineScript as jest.MockedFunction<
  typeof runPineScript
>;

const makePineContext = (plots: Record<string, unknown>) => ({
  plots: Object.fromEntries(
    Object.entries(plots).map(([plotName, value]) => [
      plotName,
      {
        data: [{ time: 1_700_000_000_000, value }],
      },
    ]),
  ),
});

describe('createAdaptiveMomentumRibbonCore', () => {
  beforeEach(() => {
    mockedRunPineScript.mockReset();
  });

  const makeRuntime = async ({
    configOverrides = {},
    currentPosition = null,
    loadScript = 'mock-pine-script',
    candles = makeCandles({ bullishLast: true }),
    marketDataOverrides = {},
    directionalTpSlPrices,
  }: {
    configOverrides?: Record<string, unknown>;
    currentPosition?: any;
    loadScript?: string;
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
      loadPineScriptFile: jest.fn(() => loadScript),
      strategyApi,
      indicatorsState: makeIndicatorsState(),
    });

    return { core, candles, marketData, strategyApi };
  };

  it('returns entry decision for bullish AMR signal', async () => {
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 1,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 1,
        activeSell: 0,
        signalOsc: 0.6,
        kcMidline: 101,
        kcUpper: 102,
        kcLower: 100,
        invalidationLevel: 99,
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
      strategyApi: makeStrategyApi(marketData),
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
    expect(decision.signal?.figures?.lines?.length ?? 0).toBeGreaterThan(0);
  });

  it('returns exit decision when opposite AMR signal appears on open position', async () => {
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 0,
        entryShort: 1,
        invalidated: 0,
        activeBuy: 0,
        activeSell: 1,
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
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 0,
        entryShort: 0,
        invalidated: 1,
        activeBuy: 1,
        activeSell: 0,
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

  it('returns skip NO_SIGNAL when AMR script has no entry signal', async () => {
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 0,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 0,
        activeSell: 0,
        signalOsc: 0,
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

  it('returns skip when pine script is missing', async () => {
    const { core, candles } = await makeRuntime({
      loadScript: '',
    });

    const decision = await core(
      candles[candles.length - 1],
      candles[candles.length - 1],
    );

    expect(decision).toEqual({
      kind: 'skip',
      code: 'AMR_SCRIPT_EMPTY',
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
  });

  it('uses AMR defaults for invalid config values and no lookback slicing when lookback<=0', async () => {
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 0,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 0,
        activeSell: 0,
        signalOsc: 0,
        kcMidline: 100,
        kcUpper: 101,
        kcLower: 99,
        invalidationLevel: 98,
      }),
    );
    const candles = makeCandles({ bullishLast: true });
    const { core } = await makeRuntime({
      candles,
      configOverrides: {
        AMR_KC_MA_TYPE: 'INVALID_KC_TYPE',
        AMR_LOOKBACK_BARS: 0,
        AMR_LINE_PLOTS: 'not-an-array',
      },
    });

    await core(candles[candles.length - 1], candles[candles.length - 1]);

    expect(mockedRunPineScript).toHaveBeenCalledWith(
      expect.objectContaining({
        candles,
        inputs: expect.objectContaining({
          'KC MA Type': 'EMA',
        }),
      }),
    );
  });

  it('returns AMR_SCRIPT_FAILED when pine execution throws and logs warning', async () => {
    mockedRunPineScript.mockRejectedValueOnce(new Error('pine-failed'));
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
      code: 'AMR_SCRIPT_FAILED',
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'AdaptiveMomentumRibbon pine run failed for %s: %s',
      'TESTUSDT',
      'Error: pine-failed',
    );
    warnSpy.mockRestore();
  });

  it('returns AMR_SIGNAL_CONFLICT when both entry flags are true', async () => {
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 1,
        entryShort: 1,
        invalidated: 0,
        activeBuy: 0,
        activeSell: 0,
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
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 1,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 1,
        activeSell: 0,
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
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 1,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 1,
        activeSell: 0,
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
    mockedRunPineScript.mockResolvedValue(
      makePineContext({
        entryLong: 1,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 1,
        activeSell: 0,
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
