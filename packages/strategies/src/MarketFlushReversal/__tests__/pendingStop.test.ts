/** @jest-environment node */

import type { BaseStrategyContextSnapshot, Direction } from '@tradejs/types';

import { config as DEFAULT_CONFIG } from '../config';
import { createMarketFlushReversalCore } from '../core';
import { createTestStateController } from '../../testUtils/stateControllerTestUtils';

const makeCandle = ({
  index,
  open,
  high,
  low,
  close,
}: {
  index: number;
  open: number;
  high: number;
  low: number;
  close: number;
}) => ({
  timestamp: 1_700_000_000_000 + index * 60_000,
  dt: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  open,
  high,
  low,
  close,
  volume: 1_000,
  turnover: close * 1_000,
});

const LONG_SETUP = makeCandle({
  index: 0,
  open: 100,
  high: 105,
  low: 90,
  close: 104,
});
const LONG_CONFIRMATION = makeCandle({
  index: 1,
  open: 104,
  high: 108,
  low: 103,
  close: 106,
});

const makeConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    ...DEFAULT_CONFIG,
    FEE_PERCENT: 0,
    SLIPPAGE_BASE_BPS: 0,
    SLIPPAGE_MARKET_IMPACT_BPS: 0,
    MAX_LOSS_VALUE: 10,
    MFR_MIN_VOLUME_REL20: 0,
    MFR_MAX_LONG_RANGE_POSITION: 0.5,
    MFR_MIN_SHORT_RANGE_POSITION: 0.5,
    MFR_MIN_REJECTION_CLOSE_POSITION: 0,
    MFR_MIN_REJECTION_CLOSE_POSITION_LONG: 0,
    MFR_MIN_REJECTION_CLOSE_POSITION_SHORT: 0,
    MFR_MIN_REJECTION_BODY_ATR: 0,
    MFR_MIN_REJECTION_BODY_ATR_LONG: 0,
    MFR_MIN_REJECTION_BODY_ATR_SHORT: 0,
    MFR_MIN_ENTRY_BODY_STRENGTH: 0,
    MFR_MIN_ENTRY_BODY_STRENGTH_LONG: 0,
    MFR_MIN_ENTRY_BODY_STRENGTH_SHORT: 0,
    MFR_MIN_CONFIRMATION_DISPLACEMENT_ATR: 0,
    MFR_MIN_CONFIRMATION_DISPLACEMENT_ATR_LONG: 0,
    MFR_MIN_CONFIRMATION_DISPLACEMENT_ATR_SHORT: 0,
    MFR_MIN_AVG_TURNOVER_20: 0,
    MFR_MIN_AVG_TURNOVER_20_LONG: 0,
    MFR_MIN_AVG_TURNOVER_20_SHORT: 0,
    MFR_STOP_ATR_BUFFER_MULT: 0.2,
    MFR_STOP_BUFFER_PCT: 0,
    MFR_TARGET_R_MULT: 1.6,
    MFR_ENTRY_MODE: 'confirmation',
    MFR_CONFIRMATION_BARS: 1,
    MFR_CONFIRMATION_BARS_LONG: 1,
    MFR_CONFIRMATION_BARS_SHORT: 1,
    MFR_PENDING_MAX_BARS: 3,
    MFR_REQUIRE_DIRECTIONAL_CONFIRMATION_BODY: true,
    LONG: { ...DEFAULT_CONFIG.LONG, minRiskRatio: 0 },
    SHORT: { ...DEFAULT_CONFIG.SHORT, minRiskRatio: 0 },
    ...overrides,
  }) as any;

const makeSetupContext = ({
  direction,
}: {
  direction: Direction;
}): BaseStrategyContextSnapshot => {
  const candle =
    direction === 'LONG'
      ? LONG_SETUP
      : makeCandle({
          index: 0,
          open: 100,
          high: 110,
          low: 95,
          close: 96,
        });

  return {
    candle,
    raw: {
      volatility: { atr: 5 },
      levels: direction === 'LONG' ? { lowLevel: 92 } : { highLevel: 108 },
    },
    regime: { momentum: { bodyStrength: 1 } },
    structure: {
      localRange:
        direction === 'LONG'
          ? { rangePosition20: 0.1, breakoutState: 'failed_low_breakout' }
          : { rangePosition20: 0.9, breakoutState: 'failed_high_breakout' },
      liquidity:
        direction === 'LONG'
          ? { sweepState: 'swept_low', sweepWickPct: 0.5 }
          : { sweepState: 'swept_high', sweepWickPct: 0.5 },
      zones:
        direction === 'LONG'
          ? { support: { lower: 88 } }
          : { resistance: { upper: 112 } },
    },
    participation: {
      volume: { volumeRel20: 2 },
      delta:
        direction === 'LONG'
          ? { buyPressurePct: 0.7, deltaDivergenceVsPrice: 'bullish' }
          : { buyPressurePct: 0.3, deltaDivergenceVsPrice: 'bearish' },
    },
  } as unknown as BaseStrategyContextSnapshot;
};

const makeConfirmationContext = ({
  direction,
}: {
  direction: Direction;
}): BaseStrategyContextSnapshot => {
  const candle =
    direction === 'LONG'
      ? LONG_CONFIRMATION
      : makeCandle({
          index: 1,
          open: 96,
          high: 97,
          low: 92,
          close: 94,
        });

  return {
    candle,
    raw: {
      volatility: { atr: 5 },
      levels: direction === 'LONG' ? { lowLevel: 101 } : { highLevel: 99 },
    },
    regime: { momentum: { bodyStrength: 1 } },
    structure: {
      zones:
        direction === 'LONG'
          ? { support: { lower: 102 } }
          : { resistance: { upper: 98 } },
    },
    participation: {},
  } as unknown as BaseStrategyContextSnapshot;
};

const makeStrategyApi = ({
  baseContext,
  decision,
  stateController,
}: {
  baseContext: { current: BaseStrategyContextSnapshot };
  decision: { timestamp: number; currentPrice: number };
  stateController: ReturnType<typeof createTestStateController>;
}) => ({
  skip: jest.fn((code: string) => ({ kind: 'skip', code })),
  entry: jest.fn(async (params: any) => ({ kind: 'entry', ...params })),
  exit: jest.fn(async (params: any) => ({ kind: 'exit', ...params })),
  getCurrentPosition: jest.fn(async () => null),
  getDecisionPriceContext: jest.fn(async () => decision),
  getBaseContext: jest.fn(() => baseContext.current),
  getCurrentIndicatorsContext: jest.fn(() => ({ indicators: {} })),
  createLastTradeController: jest.fn(() => ({
    isInCooldown: jest.fn(() => false),
    markTrade: jest.fn(),
  })),
  createStateController: stateController,
});

const runConfirmation = async ({
  direction,
  config,
  stateController = createTestStateController(),
}: {
  direction: Direction;
  config: ReturnType<typeof makeConfig>;
  stateController?: ReturnType<typeof createTestStateController>;
}) => {
  const setupContext = makeSetupContext({ direction });
  const confirmationContext = makeConfirmationContext({ direction });
  const baseContext = { current: setupContext };
  const decision = {
    timestamp: setupContext.candle.timestamp,
    currentPrice: Number(setupContext.candle.close),
  };
  const strategyApi = makeStrategyApi({
    baseContext,
    decision,
    stateController,
  });
  const core = await createMarketFlushReversalCore({
    config,
    data: [],
    strategyApi: strategyApi as any,
    indicatorsState: { snapshot: jest.fn(() => ({})) } as any,
  });

  expect(await core(setupContext.candle as any, {} as any)).toMatchObject({
    kind: 'skip',
    code: 'MFR_ENTRY_PENDING',
  });

  baseContext.current = confirmationContext;
  decision.timestamp = confirmationContext.candle.timestamp;
  decision.currentPrice = Number(confirmationContext.candle.close);

  return {
    result: (await core(confirmationContext.candle as any, {} as any)) as any,
    strategyApi,
    stateController,
  };
};

describe('MarketFlushReversal frozen pending stop', () => {
  it('does not change the immediate-entry path when enabled', async () => {
    const runImmediate = async (useFrozenPendingStop: boolean) => {
      const baseContext = { current: makeSetupContext({ direction: 'LONG' }) };
      const decision = {
        timestamp: baseContext.current.candle.timestamp,
        currentPrice: Number(baseContext.current.candle.close),
      };
      const strategyApi = makeStrategyApi({
        baseContext,
        decision,
        stateController: createTestStateController(),
      });
      const core = await createMarketFlushReversalCore({
        config: makeConfig({
          MFR_ENTRY_MODE: 'immediate',
          MFR_USE_FROZEN_PENDING_STOP: useFrozenPendingStop,
        }),
        data: [],
        strategyApi: strategyApi as any,
        indicatorsState: { snapshot: jest.fn(() => ({})) } as any,
      });

      return core(baseContext.current.candle as any, {} as any);
    };

    const control = await runImmediate(false);
    const candidate = await runImmediate(true);

    expect(candidate).toEqual(control);
    expect(candidate).toMatchObject({
      kind: 'entry',
      code: 'MFR_LONG_FLUSH_REVERSAL',
    });
    expect(
      (candidate as any).additionalIndicators.marketFlushReversalContext,
    ).not.toHaveProperty('pendingStopSource');
  });

  it('keeps the default control output and legacy state identity exact', async () => {
    const config = makeConfig({ MFR_USE_FROZEN_PENDING_STOP: false });
    const { result, stateController } = await runConfirmation({
      direction: 'LONG',
      config,
    });

    expect(result).toMatchObject({
      kind: 'entry',
      code: 'MFR_LONG_FLUSH_REVERSAL_CONFIRMATION',
      direction: 'LONG',
      orderPlan: {
        qty: 10 / 6,
        stopLossPrice: 100,
        takeProfits: [{ rate: 1, price: 115.6 }],
      },
    });
    const signalContext =
      result.additionalIndicators.marketFlushReversalContext;
    expect(signalContext).not.toHaveProperty('pendingStopSource');
    expect(signalContext).not.toHaveProperty('setupSweepExtremePrice');
    expect(signalContext).not.toHaveProperty('setupStopAnchorPrice');
    expect(signalContext).not.toHaveProperty('setupStopLossPrice');
    expect(signalContext).not.toHaveProperty('confirmationStopLossPrice');
    expect(signalContext).not.toHaveProperty('selectedStopLossPrice');
    expect(signalContext).not.toHaveProperty('setupStopDistanceAtr');
    expect(signalContext).not.toHaveProperty('confirmationStopDistanceAtr');
    expect(signalContext).not.toHaveProperty('stopDistanceDeltaAtr');

    expect(stateController.mock.calls[0]?.[2]?.configKey).toBe(
      JSON.stringify({
        entryMode: config.MFR_ENTRY_MODE,
        confirmationBars: config.MFR_CONFIRMATION_BARS,
        confirmationBarsLong: config.MFR_CONFIRMATION_BARS_LONG,
        confirmationBarsShort: config.MFR_CONFIRMATION_BARS_SHORT,
        pendingMaxBars: config.MFR_PENDING_MAX_BARS,
        requireDirectionalBody:
          config.MFR_REQUIRE_DIRECTIONAL_CONFIRMATION_BODY,
        stopAtrBufferMult: config.MFR_STOP_ATR_BUFFER_MULT,
        stopBufferPct: config.MFR_STOP_BUFFER_PCT,
        fallbackStopAtrMult: config.MFR_FALLBACK_STOP_ATR_MULT,
      }),
    );
  });

  it('uses the immutable LONG setup stop and reports its causal geometry', async () => {
    const { result } = await runConfirmation({
      direction: 'LONG',
      config: makeConfig({ MFR_USE_FROZEN_PENDING_STOP: true }),
    });

    expect(result).toMatchObject({
      kind: 'entry',
      code: 'MFR_LONG_FLUSH_REVERSAL_CONFIRMATION',
      direction: 'LONG',
      orderPlan: {
        qty: 10 / 19,
        stopLossPrice: 87,
        takeProfits: [{ rate: 1, price: 136.4 }],
      },
      additionalIndicators: {
        marketFlushReversalContext: {
          pendingStopSource: 'frozen_setup',
          setupSweepExtremePrice: 90,
          setupStopAnchorPrice: 88,
          setupStopLossPrice: 87,
          confirmationStopLossPrice: 100,
          selectedStopLossPrice: 87,
          setupStopDistanceAtr: 3.8,
          confirmationStopDistanceAtr: 1.2,
          stopDistanceDeltaAtr: 2.6,
        },
      },
    });
  });

  it('uses the immutable SHORT setup stop and keeps payoff on the same risk', async () => {
    const { result } = await runConfirmation({
      direction: 'SHORT',
      config: makeConfig({ MFR_USE_FROZEN_PENDING_STOP: true }),
    });

    expect(result).toMatchObject({
      kind: 'entry',
      code: 'MFR_SHORT_FLUSH_REVERSAL_CONFIRMATION',
      direction: 'SHORT',
      orderPlan: {
        qty: 10 / 19,
        stopLossPrice: 113,
        takeProfits: [{ rate: 1 }],
      },
      additionalIndicators: {
        marketFlushReversalContext: {
          pendingStopSource: 'frozen_setup',
          setupSweepExtremePrice: 110,
          setupStopAnchorPrice: 112,
          setupStopLossPrice: 113,
          confirmationStopLossPrice: 100,
          selectedStopLossPrice: 113,
          setupStopDistanceAtr: 3.8,
          confirmationStopDistanceAtr: 1.2,
          stopDistanceDeltaAtr: 2.6,
        },
      },
    });
    expect(result.orderPlan.takeProfits[0].price).toBeCloseTo(63.6);
  });

  it('sizes the frozen geometry against fees and slippage without exceeding the loss budget', async () => {
    const { result } = await runConfirmation({
      direction: 'LONG',
      config: makeConfig({
        MFR_USE_FROZEN_PENDING_STOP: true,
        FEE_PERCENT: 0.001,
        SLIPPAGE_BASE_BPS: 10,
        SLIPPAGE_MARKET_IMPACT_BPS: 5,
      }),
    });

    const entryPrice = 106;
    const stopLossPrice = 87;
    const executionCostRate = 0.001 + 15 / 10_000;
    const lossPerUnit =
      entryPrice -
      stopLossPrice +
      (entryPrice + stopLossPrice) * executionCostRate;

    expect(result.orderPlan.stopLossPrice).toBe(stopLossPrice);
    expect(result.orderPlan.takeProfits[0].price).toBeCloseTo(136.4);
    expect(result.orderPlan.qty * lossPerUnit).toBeCloseTo(10, 10);
  });

  it('is same-timestamp safe, survives wrapper recreation, and isolates the full candidate config', async () => {
    const stateController = createTestStateController();
    const config = makeConfig({ MFR_USE_FROZEN_PENDING_STOP: true });
    const setupContext = makeSetupContext({ direction: 'LONG' });
    const confirmationContext = makeConfirmationContext({ direction: 'LONG' });
    const baseContext = { current: setupContext };
    const decision = {
      timestamp: setupContext.candle.timestamp,
      currentPrice: Number(setupContext.candle.close),
    };
    const setupApi = makeStrategyApi({
      baseContext,
      decision,
      stateController,
    });
    const setupCore = await createMarketFlushReversalCore({
      config,
      data: [],
      strategyApi: setupApi as any,
      indicatorsState: { snapshot: jest.fn(() => ({})) } as any,
    });

    const first = await setupCore(setupContext.candle as any, {} as any);
    const duplicate = await setupCore(setupContext.candle as any, {} as any);
    expect(first).toEqual({ kind: 'skip', code: 'MFR_ENTRY_PENDING' });
    expect(duplicate).toEqual(first);
    expect(setupApi.entry).not.toHaveBeenCalled();
    expect(stateController.mock.calls[0]?.[2]?.configKey).toBe(
      JSON.stringify(config),
    );

    baseContext.current = confirmationContext;
    decision.timestamp = confirmationContext.candle.timestamp;
    decision.currentPrice = Number(confirmationContext.candle.close);
    const isolatedApi = makeStrategyApi({
      baseContext,
      decision,
      stateController,
    });
    const isolatedCore = await createMarketFlushReversalCore({
      config: makeConfig({
        MFR_USE_FROZEN_PENDING_STOP: true,
        MFR_TARGET_R_MULT: 1.7,
      }),
      data: [],
      strategyApi: isolatedApi as any,
      indicatorsState: { snapshot: jest.fn(() => ({})) } as any,
    });
    expect(
      await isolatedCore(confirmationContext.candle as any, {} as any),
    ).toEqual({ kind: 'skip', code: 'NO_MARKET_FLUSH_REVERSAL' });

    const recreatedApi = makeStrategyApi({
      baseContext,
      decision,
      stateController,
    });
    const recreatedCore = await createMarketFlushReversalCore({
      config,
      data: [],
      strategyApi: recreatedApi as any,
      indicatorsState: { snapshot: jest.fn(() => ({})) } as any,
    });
    expect(
      await recreatedCore(confirmationContext.candle as any, {} as any),
    ).toMatchObject({
      kind: 'entry',
      code: 'MFR_LONG_FLUSH_REVERSAL_CONFIRMATION',
      orderPlan: { stopLossPrice: 87 },
      additionalIndicators: {
        marketFlushReversalContext: {
          pendingStopSource: 'frozen_setup',
          setupTimestamp: setupContext.candle.timestamp,
          entryDelayBars: 1,
        },
      },
    });
  });
});
