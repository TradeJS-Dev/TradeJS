import { TestConnectorCreator } from '..';
import { setData } from '@tradejs/infra/redis';
import { round } from '@tradejs/core/math';
import {
  BACKTEST_SLIPPAGE_PERCENT,
  FEE_PERCENT,
  INITIAL_BACKTEST_AMOUNT,
} from '@tradejs/core/constants';

jest.mock('@tradejs/infra/redis', () => ({
  setData: jest.fn(),
  redisKeys: {
    cacheOrders: (userName: string, orderLogId: string) =>
      `users:${userName}:cache:tests:orders:${orderLogId}`,
    cachePositions: (userName: string, orderLogId: string) =>
      `users:${userName}:cache:tests:positions:${orderLogId}`,
  },
}));

jest.mock('node:crypto', () => {
  const actual = jest.requireActual('node:crypto');
  return {
    ...actual,
    randomUUID: () => '000000000000order-log-id',
  };
});

const mockedSetData = setData as jest.MockedFunction<typeof setData>;
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
  return price * (1 + sign * BACKTEST_SLIPPAGE_PERCENT);
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

const createBaseConnector = () =>
  ({
    kline: jest.fn(),
    getTickers: jest.fn().mockResolvedValue([]),
    getPositions: jest.fn().mockResolvedValue([]),
    getState: jest.fn().mockResolvedValue({}),
    setState: jest.fn().mockResolvedValue(undefined),
    getPosition: jest.fn().mockResolvedValue(null),
    placeOrder: jest.fn().mockResolvedValue(false),
    closePosition: jest.fn().mockResolvedValue(false),
  }) as any;

describe('TestConnectorCreator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores and merges state', async () => {
    const connector = TestConnectorCreator(createBaseConnector(), {
      userName: 'alice',
    });

    await connector.setState({ a: 1 });
    await connector.setState({ b: 2 });

    expect(await connector.getState()).toEqual({ a: 1, b: 2 });
  });

  it('opens position, blocks second open and takes full TP', async () => {
    const connector = TestConnectorCreator(createBaseConnector(), {
      userName: 'alice',
      mlEnabled: true,
    });

    const order = {
      symbol: 'BTCUSDT',
      qty: 2,
      price: 100,
      timestamp: 1_000,
      direction: 'LONG',
      signal: {
        signalId: 'sig-1',
        strategy: 'TrendLine',
        indicators: {
          maFast: [1, 2, 3],
        },
      },
    } as any;

    expect(await connector.placeOrder(order)).toBe(true);
    await expect(
      connector.setTakeProfits({
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 2,
        takeProfits: [{ price: 110, rate: 1 }],
      }),
    ).resolves.toBe(true);
    await expect(
      connector.setStopLoss({
        symbol: 'BTCUSDT',
        direction: 'LONG',
        stopLossPrice: 95,
      }),
    ).resolves.toBe(true);
    expect(await connector.placeOrder(order)).toBe(false);

    await connector.checkTp({
      open: 100,
      high: 111,
      low: 99,
      close: 109,
      volume: 1,
      turnover: 1,
      timestamp: 2_000,
    });

    const expectedEntryPrice = executionPrice(100, 'LONG', 'entry');
    const expectedExitPrice = executionPrice(110, 'LONG', 'exit');
    const expectedOpenProfit = openProfit(100, 'LONG', 2);
    const expectedExitProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 110,
      direction: 'LONG',
      qty: 2,
    });
    const expectedGrossProfit = (expectedExitPrice - expectedEntryPrice) * 2;
    const expectedOpenFee = fee(expectedEntryPrice, 2);
    const expectedCloseFee = fee(expectedExitPrice, 2);
    const expectedNetProfit = expectedOpenProfit + expectedExitProfit;

    await expect(connector.drainMlResultsBatch()).resolves.toEqual([
      {
        signalId: 'sig-1',
        profit: round(expectedNetProfit),
        tradeResult: expect.objectContaining({
          signalId: 'sig-1',
          direction: 'LONG',
          exitReason: 'take_profit',
          requestedEntryPrice: 100,
          entryPrice: round(expectedEntryPrice),
          requestedExitPrice: 110,
          exitPrice: round(expectedExitPrice),
          grossProfit: round(expectedGrossProfit),
          netProfit: round(expectedNetProfit),
          openFee: round(expectedOpenFee),
          closeFee: round(expectedCloseFee),
          totalFee: round(expectedOpenFee + expectedCloseFee),
          entrySlippageCost: round((expectedEntryPrice - 100) * 2),
          exitSlippageCost: round((110 - expectedExitPrice) * 2),
          totalSlippageCost: round(
            (expectedEntryPrice - 100) * 2 + (110 - expectedExitPrice) * 2,
          ),
        }),
      },
    ]);
    await expect(connector.drainMlResultsBatch()).resolves.toEqual([]);

    expect(await connector.getPosition('BTCUSDT')).toBeNull();

    const result = await connector.getResult();

    expect(result.orderLogId).toBe('order-log-id');
    expect(result.stat.orders).toBe(1);
    expect(result.stat.amount).toBe(
      amountAfter(expectedOpenProfit, expectedExitProfit),
    );
    expect(result.stat.profit).toBe(round(expectedNetProfit));

    expect(mockedSetData).not.toHaveBeenCalled();
    expect(result.inlineOrderLog?.[0]?.signal?.indicators).toBeUndefined();
    expect(
      result.inlineOrderLog?.[0]?.signal?.additionalIndicators,
    ).toBeUndefined();
  });

  it('applies stop loss for short position and updates final stats', async () => {
    const connector = TestConnectorCreator(createBaseConnector(), {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1_000,
      direction: 'SHORT',
    } as any);
    await connector.setStopLoss({
      symbol: 'BTCUSDT',
      direction: 'SHORT',
      stopLossPrice: 105,
    });

    await connector.checkSl({
      open: 100,
      high: 106,
      low: 98,
      close: 104,
      volume: 1,
      turnover: 1,
      timestamp: 2_000,
    });

    const result = await connector.getResult();
    const expectedOpenProfit = openProfit(100, 'SHORT');
    const expectedStopProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 105,
      direction: 'SHORT',
    });
    const expectedNetProfit = expectedOpenProfit + expectedStopProfit;

    expect(result.stat.orders).toBe(1);
    expect(result.stat.amount).toBe(
      amountAfter(expectedOpenProfit, expectedStopProfit),
    );
    expect(result.stat.profit).toBe(round(expectedNetProfit));
  });

  it('updates stop loss for an open position', async () => {
    const connector = TestConnectorCreator(createBaseConnector(), {
      userName: 'alice',
    });

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1_000,
      direction: 'LONG',
    } as any);
    await connector.setStopLoss({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    });
    await connector.setStopLoss({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      stopLossPrice: 101,
    });

    await connector.checkSl({
      open: 103,
      high: 104,
      low: 100.5,
      close: 101.5,
      volume: 1,
      turnover: 1,
      timestamp: 2_000,
    });

    const result = await connector.getResult();
    const expectedOpenProfit = openProfit(100, 'LONG');
    const expectedStopProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 101,
      direction: 'LONG',
    });
    const expectedNetProfit = expectedOpenProfit + expectedStopProfit;

    expect(result.stat.amount).toBe(
      amountAfter(expectedOpenProfit, expectedStopProfit),
    );
    expect(result.stat.profit).toBe(round(expectedNetProfit));
  });

  it('falls back to root user cache when userName is missing', async () => {
    const connector = TestConnectorCreator(createBaseConnector());

    const result = await connector.getResult();

    expect(result.orderLogId).toBe('order-log-id');
    expect(mockedSetData).not.toHaveBeenCalled();
    expect(result.inlineOrderLog).toEqual([]);
    expect(result.inlinePositionLog).toEqual([]);
  });
});
