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
  BACKTEST_SLIPPAGE_PERCENT,
  FEE_PERCENT,
  INITIAL_BACKTEST_AMOUNT,
} from '@tradejs/core/constants';
import { createTestConnector } from '../testConnector';

const baseConnector = {
  kline: jest.fn(),
  getTickers: jest.fn(),
  getPositions: jest.fn(),
  getOpenPositionPnl: jest.fn(),
};

describe('testConnector', () => {
  const backtestSlippageRate = BACKTEST_SLIPPAGE_PERCENT;
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

  it('applies BACKTEST_SLIPPAGE_PERCENT adversely to long and short entry/exit prices', async () => {
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
        profit: -0.2,
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
        profit: -0.2,
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
});
