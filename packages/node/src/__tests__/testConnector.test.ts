jest.mock('@tradejs/infra/redis', () => ({
  setData: jest.fn(),
  redisKeys: {
    cacheOrders: jest.fn(),
    cachePositions: jest.fn(),
  },
}));

import { setData } from '@tradejs/infra/redis';
import { createTestConnector } from '../testConnector';

const baseConnector = {
  kline: jest.fn(),
  getTickers: jest.fn(),
  getPositions: jest.fn(),
  getOpenPositionPnl: jest.fn(),
};

describe('testConnector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    expect(result.stat).toEqual({
      amount: 114.35,
      profit: 14.35,
      orders: 1,
    });
    expect(result.inlineOrderLog).toHaveLength(3);
    expect(result.inlinePositionLog).toHaveLength(1);
    expect(result.inlineOrderLog?.map(({ fee }) => fee)).toEqual([
      0.3, 0.165, 0.18,
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

    expect(result.stat).toEqual({
      amount: 104.39,
      profit: 4.39,
      orders: 1,
    });
    expect(result.inlineOrderLog?.[1]).toEqual(
      expect.objectContaining({
        type: 'CLOSE_LONG',
        price: 105,
        qty: 1,
        fee: 0.315,
        profit: 4.68,
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

    expect(await connector.drainMlResultsBatch()).toEqual([
      { signalId: 'sig-stop', profit: -5.58 },
    ]);
    expect(await connector.drainMlResultsBatch()).toEqual([]);

    const result = await connector.getResult();
    expect(result.stat).toEqual({
      amount: 94.42,
      profit: -5.58,
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

    expect(result.stat).toEqual({
      amount: 109.43,
      profit: 9.43,
      orders: 1,
    });
    expect(result.inlineOrderLog?.[1]).toEqual(
      expect.objectContaining({
        type: 'TAKE_PROFIT_SHORT',
        price: 90,
        qty: 1,
        fee: 0.27,
        profit: 9.73,
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

    expect(result.stat).toEqual({
      amount: 94.42,
      profit: -5.58,
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
        price: 100,
        currentPrice: 100,
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
        amount: 104.39,
        netProfit: 4.39,
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

    expect(await connector.drainMlResultsBatch()).toEqual([
      { signalId: 'sig-fast-ai', profit: 4.39 },
    ]);
    expect(await connector.drainMlResultsBatch()).toEqual([]);
  });
});
