jest.mock('@tradejs/infra/redis', () => ({
  setData: jest.fn(),
  redisKeys: {
    cacheOrders: jest.fn(),
    cachePositions: jest.fn(),
  },
}));

import { setData } from '@tradejs/infra/redis';
import { round } from '@tradejs/core/math';
import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  FEE_PERCENT,
  INITIAL_BACKTEST_AMOUNT,
} from '@tradejs/core/constants';
import { calculateEffectiveSlippageBps } from '@tradejs/core/trade';
import { createTestConnector } from '../testConnector';

const baseConnector = {
  kline: jest.fn(),
  getTickers: jest.fn(),
  getPositions: jest.fn(),
  getOpenPositionPnl: jest.fn(),
};

describe('testConnector', () => {
  const backtestSlippageRate =
    calculateEffectiveSlippageBps({
      baseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
    }) / 10_000;
  const executionPrice = (
    price: number,
    direction: 'LONG' | 'SHORT',
    stage: 'entry' | 'exit',
  ) => {
    const sign =
      direction === 'LONG'
        ? stage === 'entry'
          ? 1
          : -1
        : stage === 'entry'
          ? -1
          : 1;
    return price * (1 + sign * backtestSlippageRate);
  };
  const fee = (price: number, qty = 1) => price * qty * FEE_PERCENT;
  const openProfit = (price: number, direction: 'LONG' | 'SHORT', qty = 1) =>
    -fee(executionPrice(price, direction, 'entry'), qty);
  const exitProfit = ({
    entryPrice,
    exitPrice,
    direction,
    qty = 1,
  }: {
    entryPrice: number;
    exitPrice: number;
    direction: 'LONG' | 'SHORT';
    qty?: number;
  }) => {
    const actualEntryPrice = executionPrice(entryPrice, direction, 'entry');
    const actualExitPrice = executionPrice(exitPrice, direction, 'exit');
    const grossProfit =
      direction === 'LONG'
        ? (actualExitPrice - actualEntryPrice) * qty
        : (actualEntryPrice - actualExitPrice) * qty;
    return grossProfit - fee(actualExitPrice, qty);
  };
  const amountAfter = (...profits: number[]) =>
    round(
      INITIAL_BACKTEST_AMOUNT + profits.reduce((sum, value) => sum + value, 0),
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies effective backtest slippage adversely to long and short entry/exit prices', async () => {
    const longConnector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await longConnector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
    });
    await longConnector.closePosition({
      symbol: 'ETHUSDT',
      price: 110,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const longOrders = (await longConnector.getResult()).inlineOrderLog ?? [];
    expect(longOrders[0]).toEqual(
      expect.objectContaining({
        type: 'OPEN_LONG',
        profit: -0.1,
      }),
    );
    expect(longOrders[0].price).toBeCloseTo(100 * (1 + backtestSlippageRate));
    expect(longOrders[1]).toEqual(
      expect.objectContaining({
        type: 'CLOSE_LONG',
        profit: round(
          exitProfit({ entryPrice: 100, exitPrice: 110, direction: 'LONG' }),
        ),
      }),
    );
    expect(longOrders[1].price).toBeCloseTo(110 * (1 - backtestSlippageRate));

    const shortConnector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await shortConnector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'SHORT',
    });
    await shortConnector.closePosition({
      symbol: 'ETHUSDT',
      price: 90,
      isLimit: false,
      timestamp: 2,
      direction: 'SHORT',
    });

    const shortOrders = (await shortConnector.getResult()).inlineOrderLog ?? [];
    expect(shortOrders[0]).toEqual(
      expect.objectContaining({
        type: 'OPEN_SHORT',
        profit: -0.1,
      }),
    );
    expect(shortOrders[0].price).toBeCloseTo(100 * (1 - backtestSlippageRate));
    expect(shortOrders[1]).toEqual(
      expect.objectContaining({
        type: 'CLOSE_SHORT',
        profit: round(
          exitProfit({ entryPrice: 100, exitPrice: 90, direction: 'SHORT' }),
        ),
      }),
    );
    expect(shortOrders[1].price).toBeCloseTo(90 * (1 + backtestSlippageRate));
  });

  it('aggregates explicit same-direction grid increases at weighted average price', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      executionCostModel: {
        fees: { makerRate: 0, takerRate: 0, source: 'config' },
        funding: { enabled: false, source: 'disabled', points: 0 },
        slippage: {
          baseBps: 0,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
          source: 'config',
        },
        leverage: { requested: 1, effective: 1, maxAllowed: null },
        quality: 'full',
        capturedAt: 1,
      },
    });

    await expect(
      connector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 100,
        timestamp: 1,
        direction: 'LONG',
      }),
    ).resolves.toBe(true);
    await expect(
      connector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 90,
        timestamp: 2,
        direction: 'LONG',
        positionIntent: 'increase',
      }),
    ).resolves.toBe(true);

    await expect(connector.getPosition('ETHUSDT')).resolves.toEqual(
      expect.objectContaining({ qty: 2, price: 95, direction: 'LONG' }),
    );
    await connector.setTakeProfits({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [{ price: 100, rate: 1 }],
    });
    await connector.checkExits({
      timestamp: 3,
      open: 95,
      high: 101,
      low: 94,
      close: 100,
      volume: 1,
      turnover: 100,
    });

    const result = await connector.getResult();
    expect(result.stat).toEqual({
      amount: INITIAL_BACKTEST_AMOUNT + 10,
      profit: 10,
      orders: 1,
    });
    expect(result.inlineOrderLog?.map(({ type }) => type)).toEqual([
      'OPEN_LONG',
      'OPEN_LONG',
      'TAKE_PROFIT_LONG',
    ]);
    expect(result.inlinePositionLog).toHaveLength(1);
  });

  it('matches instrument qty-step normalization and minimum-order rejection in backtests', async () => {
    const instrument = {
      provider: 'bybit',
      symbol: 'ETHUSDT',
      kind: 'perpetual',
      assetClass: 'crypto',
      universe: 'crypto',
      status: 'trading',
      venueMetadata: { qtyStep: 0.01, minOrderQty: 0.01 },
    } as const;
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      instrument,
    });
    const normalizedSignal = {} as any;

    await expect(
      connector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 0.056,
        price: 100,
        timestamp: 1,
        direction: 'LONG',
        signal: normalizedSignal,
      }),
    ).resolves.toBe(true);
    await expect(connector.getPosition('ETHUSDT')).resolves.toEqual(
      expect.objectContaining({ qty: 0.05 }),
    );
    expect(normalizedSignal.orderQty).toBe(0.05);
    expect(normalizedSignal.orderValue).toBe(5);

    const rejectedConnector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      instrument,
    });
    const rejectedSignal = {} as any;
    await expect(
      rejectedConnector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 0.009,
        price: 100,
        timestamp: 1,
        direction: 'LONG',
        signal: rejectedSignal,
      }),
    ).resolves.toBe(false);
    await expect(rejectedConnector.getPosition('ETHUSDT')).resolves.toBeNull();
    expect(rejectedSignal.orderQty).toBe(0);
    expect(rejectedSignal.orderValue).toBe(0);
    expect(rejectedSignal.orderFailureReason).toBe('QTY_BELOW_MIN_ORDER');
  });

  it('closes the full unequal-size short basket and aggregates its trade telemetry', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      mlEnabled: true,
      executionCostModel: {
        fees: { makerRate: 0, takerRate: 0, source: 'config' },
        funding: { enabled: false, source: 'disabled', points: 0 },
        slippage: {
          baseBps: 0,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
          source: 'config',
        },
        leverage: { requested: 1, effective: 1, maxAllowed: null },
        quality: 'full',
        capturedAt: 1,
      },
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 2,
      price: 100,
      timestamp: 1,
      direction: 'SHORT',
      signal: { signalId: 'grid-short' } as any,
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 110,
      timestamp: 2,
      direction: 'SHORT',
      positionIntent: 'increase',
      signal: { signalId: 'grid-short-increase-2' } as any,
    });
    await connector.setStopLoss({
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      stopLossPrice: 120,
    });

    await expect(connector.getPosition('ETHUSDT')).resolves.toEqual(
      expect.objectContaining({
        qty: 3,
        price: expect.closeTo(103.333333, 5),
        slPrice: 120,
        direction: 'SHORT',
      }),
    );
    await connector.checkSl({
      timestamp: 3,
      open: 110,
      high: 121,
      low: 109,
      close: 120,
      volume: 1,
      turnover: 120,
    });

    const batch = await connector.drainMlResultsBatch();
    expect(batch).toHaveLength(2);
    expect(batch[0]).toEqual(
      expect.objectContaining({
        signalId: 'grid-short',
        profit: -40,
        tradeResult: expect.objectContaining({
          signalId: 'grid-short',
          positionCycleId: 'grid-short',
          direction: 'SHORT',
          qty: 2,
          closedQty: 2,
          entryPrice: 100,
          exitPrice: 120,
          exitReason: 'stop_loss',
          grossProfit: -40,
          netProfit: -40,
        }),
      }),
    );
    expect(batch[1]).toEqual(
      expect.objectContaining({
        signalId: 'grid-short-increase-2',
        profit: -10,
        tradeResult: expect.objectContaining({
          signalId: 'grid-short-increase-2',
          positionCycleId: 'grid-short',
          direction: 'SHORT',
          qty: 1,
          closedQty: 1,
          entryPrice: 110,
          exitPrice: 120,
          exitReason: 'stop_loss',
          grossProfit: -10,
          netProfit: -10,
        }),
      }),
    );
    expect(batch.reduce((total, row) => total + row.profit, 0)).toBe(-50);
    const result = await connector.getResult();
    expect(result.stat).toEqual({
      amount: INITIAL_BACKTEST_AMOUNT - 50,
      profit: -50,
      orders: 1,
    });
    expect(result.inlineOrderLog?.map(({ type }) => type)).toEqual([
      'OPEN_SHORT',
      'OPEN_SHORT',
      'STOP_LOSS_SHORT',
    ]);
    expect(result.inlinePositionLog).toHaveLength(1);
  });

  it('attributes fees and funding to every exported grid entry leg without duplicating basket PnL', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      aiEnabled: true,
      executionCostModel: {
        fees: { makerRate: 0.001, takerRate: 0.001, source: 'config' },
        funding: { enabled: true, source: 'historical', points: 1 },
        slippage: {
          baseBps: 0,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
          source: 'config',
        },
        leverage: { requested: 1, effective: 1, maxAllowed: null },
        quality: 'full',
        capturedAt: 1,
      },
      fundingRates: [{ symbol: 'ETHUSDT', timestamp: 5, rate: 0.01 }],
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: { signalId: 'grid-open' } as any,
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 3,
      price: 80,
      timestamp: 2,
      direction: 'LONG',
      positionIntent: 'increase',
      signal: { signalId: 'grid-increase' } as any,
    });
    await connector.checkExits({
      timestamp: 10,
      open: 90,
      high: 90,
      low: 90,
      close: 90,
      volume: 1,
      turnover: 90,
    });
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 90,
      timestamp: 11,
      direction: 'LONG',
    });

    const batch = await connector.drainMlResultsBatch();
    expect(batch).toEqual([
      expect.objectContaining({
        signalId: 'grid-open',
        profit: -11.09,
        tradeResult: expect.objectContaining({
          qty: 1,
          openFee: 0.1,
          closeFee: 0.09,
          fundingFee: 0.9,
          netProfit: -11.09,
        }),
      }),
      expect.objectContaining({
        signalId: 'grid-increase',
        profit: 26.79,
        tradeResult: expect.objectContaining({
          qty: 3,
          openFee: 0.24,
          closeFee: 0.27,
          fundingFee: 2.7,
          netProfit: 26.79,
        }),
      }),
    ]);
    const result = await connector.getResult();
    expect(round(batch.reduce((total, row) => total + row.profit, 0))).toBe(
      result.stat.profit,
    );
  });

  it('attributes partial take profits pro rata across exported grid entry legs', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      aiEnabled: true,
      executionCostModel: {
        fees: { makerRate: 0, takerRate: 0, source: 'config' },
        funding: { enabled: false, source: 'disabled', points: 0 },
        slippage: {
          baseBps: 0,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
          source: 'config',
        },
        leverage: { requested: 1, effective: 1, maxAllowed: null },
        quality: 'full',
        capturedAt: 1,
      },
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: { signalId: 'grid-open' } as any,
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 3,
      price: 80,
      timestamp: 2,
      direction: 'LONG',
      positionIntent: 'increase',
      signal: { signalId: 'grid-increase' } as any,
    });
    await connector.setTakeProfits({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [
        { price: 90, rate: 0.5 },
        { price: 100, rate: 0.5 },
      ],
    });
    await connector.checkExits({
      timestamp: 3,
      open: 85,
      high: 91,
      low: 84,
      close: 90,
      volume: 1,
      turnover: 90,
    });
    await connector.checkExits({
      timestamp: 4,
      open: 90,
      high: 101,
      low: 89,
      close: 100,
      volume: 1,
      turnover: 100,
    });

    const batch = await connector.drainMlResultsBatch();
    expect(batch).toEqual([
      expect.objectContaining({
        signalId: 'grid-open',
        profit: -5,
        tradeResult: expect.objectContaining({
          qty: 1,
          closedQty: 1,
          requestedExitPrice: 95,
          grossProfit: -5,
        }),
      }),
      expect.objectContaining({
        signalId: 'grid-increase',
        profit: 45,
        tradeResult: expect.objectContaining({
          qty: 3,
          closedQty: 3,
          requestedExitPrice: 95,
          grossProfit: 45,
        }),
      }),
    ]);
    expect((await connector.getResult()).stat.profit).toBe(40);
  });

  it('rejects accidental or opposite-direction increases while a position exists', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
    });

    await expect(
      connector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 99,
        timestamp: 2,
        direction: 'LONG',
      }),
    ).resolves.toBe(false);
    await expect(
      connector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 99,
        timestamp: 2,
        direction: 'SHORT',
        positionIntent: 'increase',
      }),
    ).resolves.toBe(false);
  });

  it('adds signal execution spread and market impact to slippage', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });
    const dynamicSlippageRate =
      calculateEffectiveSlippageBps({
        baseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
        spreadBps: 15,
        marketImpactBps: 5,
      }) / 10_000;

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        additionalIndicators: {
          executionSlippage: {
            spreadBps: 15,
            marketImpactBps: 5,
          },
        },
      },
    } as any);
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 110,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const orders = (await connector.getResult()).inlineOrderLog ?? [];
    expect(orders[0].price).toBeCloseTo(100 * (1 + dynamicSlippageRate));
    expect(orders[1].price).toBeCloseTo(110 * (1 - dynamicSlippageRate));
  });

  it('ignores signal delay risk in entry slippage', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      aiEnabled: true,
    });
    const signal = {
      signalId: 'sig-delay',
      interval: '15',
      indicators: {
        candles15m: [{ close: 100 }, { close: 101 }, { close: 102 }],
      },
      additionalIndicators: {},
    };
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal,
    } as any);
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 110,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const orders = (await connector.getResult()).inlineOrderLog ?? [];
    expect(orders[0].price).toBeCloseTo(100 * (1 + backtestSlippageRate));
    expect(orders[1].price).toBeCloseTo(110 * (1 - backtestSlippageRate));
    expect(await connector.drainMlResultsBatch()).toEqual([
      expect.objectContaining({
        signalId: 'sig-delay',
        tradeResult: expect.objectContaining({
          entryBaseSlippageBps: round(BACKTEST_BASE_SLIPPAGE_BPS),
          entrySpreadBps: 0,
          entrySpreadSlippageBps: 0,
          entryDelayRiskBps: 0,
          exitBaseSlippageBps: round(BACKTEST_BASE_SLIPPAGE_BPS),
          exitSpreadBps: 0,
          exitSpreadSlippageBps: 0,
          exitDelayRiskBps: null,
        }),
      }),
    ]);
  });

  it('returns inline logs and final stat after take profits', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      aiEnabled: true,
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        signalId: 'sig-1',
        indicators: { expensive: true },
      } as any,
    });
    await connector.setTakeProfits({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [
        { price: 110, rate: 0.5 },
        { price: 120, rate: 0.5 },
      ],
    } as any);
    await connector.setStopLoss({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    } as any);

    await connector.checkTp({
      timestamp: 2,
      open: 100,
      high: 111,
      low: 99,
      close: 110,
      volume: 1,
      turnover: 1,
    });
    await connector.checkTp({
      timestamp: 3,
      open: 110,
      high: 121,
      low: 109,
      close: 120,
      volume: 1,
      turnover: 1,
    });

    const result = await connector.getResult();

    const expectedOpenProfit = openProfit(100, 'LONG');
    const expectedTp1Profit = exitProfit({
      entryPrice: 100,
      exitPrice: 110,
      direction: 'LONG',
      qty: 0.5,
    });
    const expectedTp2Profit = exitProfit({
      entryPrice: 100,
      exitPrice: 120,
      direction: 'LONG',
      qty: 0.5,
    });
    const expectedTotalProfit =
      expectedOpenProfit + expectedTp1Profit + expectedTp2Profit;

    expect(result.stat).toEqual({
      amount: round(INITIAL_BACKTEST_AMOUNT + expectedTotalProfit),
      profit: round(expectedTotalProfit),
      orders: 1,
    });
    expect(result.inlineOrderLog).toHaveLength(3);
    expect(result.inlinePositionLog).toHaveLength(1);
    expect(result.inlineOrderLog?.map(({ fee }) => fee)).toEqual([
      fee(executionPrice(100, 'LONG', 'entry')),
      fee(executionPrice(110, 'LONG', 'exit'), 0.5),
      fee(executionPrice(120, 'LONG', 'exit'), 0.5),
    ]);
    expect(result.inlineOrderLog?.[0].signal).toEqual(
      expect.objectContaining({ signalId: 'sig-1' }),
    );
    expect(
      (result.inlineOrderLog?.[0].signal as any).indicators,
    ).toBeUndefined();
    expect(
      (result.inlineOrderLog?.[0].signal as any).additionalIndicators,
    ).toBeUndefined();
    expect(setData).not.toHaveBeenCalled();
  });

  it.each([
    {
      direction: 'LONG' as const,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      candle: {
        timestamp: 2,
        open: 100,
        high: 112,
        low: 94,
        close: 108,
        volume: 1,
        turnover: 1,
      },
      expectedStopType: 'STOP_LOSS_LONG',
      unexpectedTpType: 'TAKE_PROFIT_LONG',
    },
    {
      direction: 'SHORT' as const,
      takeProfitPrice: 90,
      stopLossPrice: 105,
      candle: {
        timestamp: 2,
        open: 100,
        high: 106,
        low: 88,
        close: 92,
        volume: 1,
        turnover: 1,
      },
      expectedStopType: 'STOP_LOSS_SHORT',
      unexpectedTpType: 'TAKE_PROFIT_SHORT',
    },
  ])(
    'uses pessimistic SL-before-TP ordering when one $direction candle hits both',
    async ({
      direction,
      takeProfitPrice,
      stopLossPrice,
      candle,
      expectedStopType,
      unexpectedTpType,
    }) => {
      const connector = createTestConnector(baseConnector as any, {
        userName: 'alice',
      });

      await connector.placeOrder({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 100,
        isLimit: false,
        timestamp: 1,
        direction,
      });
      await connector.setTakeProfits({
        symbol: 'ETHUSDT',
        direction,
        takeProfits: [{ price: takeProfitPrice, rate: 1 }],
      } as any);
      await connector.setStopLoss({
        symbol: 'ETHUSDT',
        direction,
        stopLossPrice,
      } as any);

      await connector.checkExits(candle);

      const orderTypes = (
        (await connector.getResult()).inlineOrderLog ?? []
      ).map(({ type }) => type);
      expect(orderTypes).toContain(expectedStopType);
      expect(orderTypes).not.toContain(unexpectedTpType);
    },
  );

  it('reuses the same inline log arrays across repeated getResult calls', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
    });
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 105,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const firstResult = await connector.getResult();
    const secondResult = await connector.getResult();

    expect(secondResult.inlineOrderLog).toBe(firstResult.inlineOrderLog);
    expect(secondResult.inlinePositionLog).toBe(firstResult.inlinePositionLog);
    expect(secondResult.inlineOrderLog).toHaveLength(2);
    expect(secondResult.inlinePositionLog).toHaveLength(1);
  });

  it('subtracts exit fee on manual close', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
    });
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 105,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const result = await connector.getResult();

    const expectedOpenProfit = openProfit(100, 'LONG');
    const expectedCloseProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 105,
      direction: 'LONG',
    });
    const expectedTotalProfit = expectedOpenProfit + expectedCloseProfit;

    expect(result.stat).toEqual({
      amount: round(INITIAL_BACKTEST_AMOUNT + expectedTotalProfit),
      profit: round(expectedTotalProfit),
      orders: 1,
    });
    expect(result.inlineOrderLog?.[1]).toEqual(
      expect.objectContaining({
        type: 'CLOSE_LONG',
        price: executionPrice(105, 'LONG', 'exit'),
        qty: 1,
        fee: fee(executionPrice(105, 'LONG', 'exit')),
        profit: round(expectedCloseProfit),
      }),
    );
  });

  it('tracks closed signal profit for stop loss exits and drains the batch once', async () => {
    const connector = createTestConnector(baseConnector as any, {
      mlEnabled: true,
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        signalId: 'sig-stop',
      } as any,
    });
    await connector.setStopLoss({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    } as any);

    await connector.checkSl({
      timestamp: 2,
      open: 100,
      high: 101,
      low: 94,
      close: 95,
      volume: 1,
      turnover: 1,
    });

    const expectedEntryPrice = executionPrice(100, 'LONG', 'entry');
    const expectedExitPrice = executionPrice(95, 'LONG', 'exit');
    const expectedOpenProfit = openProfit(100, 'LONG');
    const expectedExitProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 95,
      direction: 'LONG',
    });
    const expectedGrossProfit = expectedExitPrice - expectedEntryPrice;
    const expectedOpenFee = fee(expectedEntryPrice);
    const expectedCloseFee = fee(expectedExitPrice);
    const expectedNetProfit = expectedOpenProfit + expectedExitProfit;

    expect(await connector.drainMlResultsBatch()).toEqual([
      {
        signalId: 'sig-stop',
        profit: round(expectedNetProfit),
        tradeResult: expect.objectContaining({
          signalId: 'sig-stop',
          direction: 'LONG',
          exitReason: 'stop_loss',
          requestedEntryPrice: 100,
          entryPrice: expectedEntryPrice,
          requestedExitPrice: 95,
          exitPrice: expectedExitPrice,
          grossProfit: round(expectedGrossProfit),
          netProfit: round(expectedNetProfit),
          openFee: round(expectedOpenFee),
          closeFee: round(expectedCloseFee),
          totalFee: round(expectedOpenFee + expectedCloseFee),
          entrySlippageCost: round(expectedEntryPrice - 100),
          exitSlippageCost: round(95 - expectedExitPrice),
          totalSlippageCost: round(
            expectedEntryPrice - 100 + (95 - expectedExitPrice),
          ),
        }),
      },
    ]);
    expect(await connector.drainMlResultsBatch()).toEqual([]);

    const result = await connector.getResult();
    expect(result.stat).toEqual({
      amount: amountAfter(expectedOpenProfit, expectedExitProfit),
      profit: round(expectedNetProfit),
      orders: 1,
    });
    expect(result.inlineOrderLog).toHaveLength(2);
    expect(result.inlinePositionLog).toHaveLength(1);
  });

  it('preserves sub-unit price precision in closed signal trade results', async () => {
    const connector = createTestConnector(baseConnector as any, {
      mlEnabled: true,
    });

    await connector.placeOrder({
      symbol: 'TOKENUSDT',
      qty: 1000,
      price: 0.04228,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        signalId: 'sig-precision',
      } as any,
    });
    await connector.closePosition({
      symbol: 'TOKENUSDT',
      price: 0.04321,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const expectedEntryPrice = executionPrice(0.04228, 'LONG', 'entry');
    const expectedExitPrice = executionPrice(0.04321, 'LONG', 'exit');
    const [closedResult] = await connector.drainMlResultsBatch();

    expect(closedResult?.tradeResult).toEqual(
      expect.objectContaining({
        requestedEntryPrice: 0.04228,
        entryPrice: round(expectedEntryPrice, 8),
        requestedExitPrice: 0.04321,
        exitPrice: round(expectedExitPrice, 8),
      }),
    );
  });

  it('computes short take profit with exit fee', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'SHORT',
    });
    await connector.setTakeProfits({
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      takeProfits: [{ price: 90, rate: 1 }],
    } as any);

    await connector.checkTp({
      timestamp: 2,
      open: 100,
      high: 101,
      low: 89,
      close: 90,
      volume: 1,
      turnover: 1,
    });

    const result = await connector.getResult();

    const expectedOpenProfit = openProfit(100, 'SHORT');
    const expectedTpProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 90,
      direction: 'SHORT',
    });
    const expectedTotalProfit = expectedOpenProfit + expectedTpProfit;

    expect(result.stat).toEqual({
      amount: round(INITIAL_BACKTEST_AMOUNT + expectedTotalProfit),
      profit: round(expectedTotalProfit),
      orders: 1,
    });
    expect(result.inlineOrderLog?.[1]).toEqual(
      expect.objectContaining({
        type: 'TAKE_PROFIT_SHORT',
        price: executionPrice(90, 'SHORT', 'exit'),
        qty: 1,
        fee: fee(executionPrice(90, 'SHORT', 'exit')),
        profit: round(expectedTpProfit),
      }),
    );
  });

  it('respects stop loss priority over take profit on the same candle', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
    });
    await connector.setTakeProfits({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      takeProfits: [{ price: 110, rate: 1 }],
    } as any);
    await connector.setStopLoss({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    } as any);

    const candle = {
      timestamp: 2,
      open: 100,
      high: 111,
      low: 94,
      close: 108,
      volume: 1,
      turnover: 1,
    };

    await connector.checkExits(candle);

    const result = await connector.getResult();

    const expectedOpenProfit = openProfit(100, 'LONG');
    const expectedStopProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 95,
      direction: 'LONG',
    });
    const expectedTotalProfit = expectedOpenProfit + expectedStopProfit;

    expect(result.stat).toEqual({
      amount: round(INITIAL_BACKTEST_AMOUNT + expectedTotalProfit),
      profit: round(expectedTotalProfit),
      orders: 1,
    });
    expect(result.inlineOrderLog?.map(({ type }) => type)).toEqual([
      'OPEN_LONG',
      'STOP_LOSS_LONG',
    ]);
  });

  it('does not close a delayed intrabar entry before its entry timestamp', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1_300,
      direction: 'LONG',
    });
    await connector.setStopLoss({
      symbol: 'ETHUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    } as any);

    await connector.checkExits({
      timestamp: 1_000,
      open: 100,
      high: 101,
      low: 94,
      close: 96,
      volume: 1,
      turnover: 1,
    });

    const result = await connector.getResult();
    expect(result.inlineOrderLog?.[1]).toEqual(
      expect.objectContaining({
        type: 'STOP_LOSS_LONG',
        timestamp: 1_300,
      }),
    );
    expect(result.inlinePositionLog?.[0].close.timestamp).toBe(1_300);
  });

  it('delegates unrealized pnl snapshots to the underlying connector when available', async () => {
    baseConnector.getOpenPositionPnl.mockResolvedValue([
      {
        symbol: 'ETHUSDT',
        qty: 1,
        price: 100,
        currentPrice: 110,
        unrealizedPnl: 10,
        direction: 'LONG',
      },
    ]);

    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
    });

    await expect(connector.getOpenPositionPnl?.()).resolves.toEqual([
      {
        symbol: 'ETHUSDT',
        qty: 1,
        price: 100,
        currentPrice: 110,
        unrealizedPnl: 10,
        direction: 'LONG',
      },
    ]);
  });

  it('returns a zero-pnl snapshot for the in-memory open position when the underlying connector has no snapshot method', async () => {
    const connector = createTestConnector(
      {
        ...baseConnector,
        getOpenPositionPnl: undefined,
      } as any,
      {
        userName: 'alice',
      },
    );

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
    });

    await expect(connector.getOpenPositionPnl?.()).resolves.toEqual([
      {
        symbol: 'ETHUSDT',
        qty: 1,
        price: executionPrice(100, 'LONG', 'entry'),
        currentPrice: executionPrice(100, 'LONG', 'entry'),
        unrealizedPnl: 0,
        direction: 'LONG',
      },
    ]);
  });

  it('omits inline logs in fast mode but still returns full summary stats', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      fastMode: true,
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
    });
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 105,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const result = await connector.getResult();

    expect(result.inlineOrderLog).toBeUndefined();
    expect(result.inlinePositionLog).toBeUndefined();
    expect(result.stat).toEqual(
      expect.objectContaining({
        amount: amountAfter(
          openProfit(100, 'LONG'),
          exitProfit({ entryPrice: 100, exitPrice: 105, direction: 'LONG' }),
        ),
        netProfit: round(
          openProfit(100, 'LONG') +
            exitProfit({
              entryPrice: 100,
              exitPrice: 105,
              direction: 'LONG',
            }),
        ),
        orders: 1,
        wins: 1,
        losses: 0,
        winRate: 100,
      }),
    );
  });

  it('still tracks closed signal results in fast mode for AI/ML dataset writers', async () => {
    const connector = createTestConnector(baseConnector as any, {
      userName: 'alice',
      aiEnabled: true,
      fastMode: true,
    });

    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        signalId: 'sig-fast-ai',
      } as any,
    });
    await connector.closePosition({
      symbol: 'ETHUSDT',
      price: 105,
      isLimit: false,
      timestamp: 2,
      direction: 'LONG',
    });

    const expectedOpenProfit = openProfit(100, 'LONG');
    const expectedCloseProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 105,
      direction: 'LONG',
    });
    const expectedEntryPrice = executionPrice(100, 'LONG', 'entry');
    const expectedExitPrice = executionPrice(105, 'LONG', 'exit');

    expect(await connector.drainMlResultsBatch()).toEqual([
      {
        signalId: 'sig-fast-ai',
        profit: round(expectedOpenProfit + expectedCloseProfit),
        tradeResult: expect.objectContaining({
          signalId: 'sig-fast-ai',
          exitReason: 'exit',
          netProfit: round(expectedOpenProfit + expectedCloseProfit),
          totalFee: round(fee(expectedEntryPrice) + fee(expectedExitPrice)),
          totalSlippageCost: round(
            expectedEntryPrice - 100 + (105 - expectedExitPrice),
          ),
        }),
      },
    ]);
    expect(await connector.drainMlResultsBatch()).toEqual([]);
  });

  it('applies historical funding to long positions', async () => {
    const connector = createTestConnector(baseConnector as any, {
      aiEnabled: true,
      executionCostModel: {
        fees: { makerRate: 0, takerRate: 0, source: 'config' },
        funding: { enabled: true, source: 'historical', points: 1 },
        slippage: {
          baseBps: 0,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
          source: 'config',
        },
        leverage: { requested: 1, effective: 1, maxAllowed: null },
        quality: 'full',
        capturedAt: 1,
      },
      fundingRates: [{ symbol: 'AAPLUSDT', timestamp: 5, rate: 0.01 }],
    });

    await connector.placeOrder({
      symbol: 'AAPLUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'LONG',
      signal: { signalId: 'funded-long' } as any,
    });
    await connector.checkExits({
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
      turnover: 100,
      timestamp: 10,
    });
    await connector.closePosition({
      symbol: 'AAPLUSDT',
      price: 100,
      isLimit: false,
      timestamp: 11,
      direction: 'LONG',
    });

    expect(await connector.drainMlResultsBatch()).toEqual([
      expect.objectContaining({
        signalId: 'funded-long',
        profit: -1,
        tradeResult: expect.objectContaining({
          fundingFee: 1,
          netProfit: -1,
        }),
      }),
    ]);
  });

  it('credits positive funding to shorts exactly once per timestamp', async () => {
    const connector = createTestConnector(baseConnector as any, {
      aiEnabled: true,
      executionCostModel: {
        fees: { makerRate: 0, takerRate: 0, source: 'config' },
        funding: { enabled: true, source: 'historical', points: 1 },
        slippage: {
          baseBps: 0,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
          source: 'config',
        },
        leverage: { requested: 1, effective: 1, maxAllowed: null },
        quality: 'full',
        capturedAt: 1,
      },
      fundingRates: [{ symbol: 'AAPLUSDT', timestamp: 5, rate: 0.01 }],
    });
    const candle = {
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1,
      turnover: 100,
      timestamp: 10,
    };

    await connector.placeOrder({
      symbol: 'AAPLUSDT',
      qty: 1,
      price: 100,
      isLimit: false,
      timestamp: 1,
      direction: 'SHORT',
      signal: { signalId: 'funded-short' } as any,
    });
    await connector.checkExits(candle);
    await connector.checkExits({ ...candle, timestamp: 11 });
    await connector.closePosition({
      symbol: 'AAPLUSDT',
      price: 100,
      isLimit: false,
      timestamp: 12,
      direction: 'SHORT',
    });

    expect(await connector.drainMlResultsBatch()).toEqual([
      expect.objectContaining({
        signalId: 'funded-short',
        profit: 1,
        tradeResult: expect.objectContaining({
          fundingFee: -1,
          netProfit: 1,
        }),
      }),
    ]);
  });
});
