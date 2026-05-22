import { ByBitConnectorCreator } from '..';
import { getClient } from '../client';
import { delay } from '@tradejs/core/async';
import {
  getSymbolMeta,
  mapPositionData,
  normalizePrice,
  normalizeQty,
} from '../utils';
import {
  getCandlesRange,
  getDataEdges,
  toRows,
  upsertCandles,
} from '@tradejs/infra/timescale';
import { logger } from '@tradejs/infra/logger';

jest.mock('../client', () => ({
  getClient: jest.fn(),
}));

jest.mock('@tradejs/core/async', () => ({
  delay: jest.fn(async () => undefined),
}));

jest.mock('../utils', () => ({
  mapKlineToChartData: jest.fn((data) => data),
  normalizePrice: jest.fn((price) => ({
    priceNum: price,
    priceStr: `${price}`,
  })),
  normalizeQty: jest.fn((qty) => ({ qtyNum: qty, qtyStr: qty.toFixed(3) })),
  getSymbolMeta: jest.fn(),
  mapPositionData: jest.fn(),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

jest.mock('@tradejs/infra/timescale', () => ({
  getCandlesRange: jest.fn(),
  getDataEdges: jest.fn(),
  upsertCandles: jest.fn(),
  toRows: jest.fn((provider, symbol, interval, data) => ({
    provider,
    symbol,
    interval,
    data,
  })),
}));

const mockedGetClient = getClient as jest.MockedFunction<typeof getClient>;
const mockedGetSymbolMeta = getSymbolMeta as jest.MockedFunction<
  typeof getSymbolMeta
>;
const mockedDelay = delay as jest.MockedFunction<typeof delay>;
const mockedNormalizeQty = normalizeQty as jest.MockedFunction<
  typeof normalizeQty
>;
const mockedNormalizePrice = normalizePrice as jest.MockedFunction<
  typeof normalizePrice
>;
const mockedMapPositionData = mapPositionData as jest.MockedFunction<
  typeof mapPositionData
>;
const mockedGetDataEdges = getDataEdges as jest.MockedFunction<
  typeof getDataEdges
>;
const mockedGetCandlesRange = getCandlesRange as jest.MockedFunction<
  typeof getCandlesRange
>;
const mockedToRows = toRows as jest.MockedFunction<typeof toRows>;
const mockedUpsertCandles = upsertCandles as jest.MockedFunction<
  typeof upsertCandles
>;
const mockedLoggerLog = logger.log as jest.MockedFunction<typeof logger.log>;

describe('ByBitConnectorCreator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns empty data for unsupported interval in kline', async () => {
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '2' as any,
      end: Date.now(),
    });

    expect(result).toEqual([]);
    expect(mockedGetDataEdges).not.toHaveBeenCalled();
  });

  it('returns cache-only kline data from DB rows', async () => {
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    mockedGetDataEdges.mockResolvedValue({ min: undefined, max: undefined });
    mockedGetCandlesRange.mockResolvedValue([
      {
        ts: new Date(1_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
      } as any,
    ]);

    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '1',
      start: 1_000,
      end: 2_000,
      cacheOnly: true,
    });

    expect(result).toEqual([
      expect.objectContaining({
        timestamp: 1_000,
        open: 1,
        close: 1.5,
      }),
    ]);
    expect(mockedGetCandlesRange).toHaveBeenCalledWith(
      'bybit',
      'BTCUSDT',
      1,
      1000,
      2000,
    );
  });

  it('falls back to exchange kline when timescale is unavailable', async () => {
    mockedGetDataEdges.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );
    const client = {
      getKline: jest.fn().mockResolvedValue({
        result: {
          list: [{ timestamp: 2 }, { timestamp: 1 }],
        },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: Date.now(),
      silent: true,
    });

    expect(client.getKline).toHaveBeenCalledTimes(1);
    expect(mockedGetClient).toHaveBeenCalledWith(
      { userName: 'alice' },
      'public',
    );
    expect(mockedGetCandlesRange).not.toHaveBeenCalled();
    expect(result).toEqual([{ timestamp: 1 }, { timestamp: 2 }]);
  });

  it('returns null from getPosition when client is missing', async () => {
    mockedGetClient.mockResolvedValue(null);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    expect(await connector.getPosition('BTCUSDT')).toBeNull();
  });

  it('maps first active position from exchange response', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 0,
        result: { list: [{ raw: true }] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedMapPositionData.mockReturnValue([
      { symbol: 'BTCUSDT', price: 100, qty: 1, direction: 'LONG' } as any,
    ]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const position = await connector.getPosition('BTCUSDT');

    expect(client.getPositionInfo).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'BTCUSDT' }),
    );
    expect(mockedGetClient).toHaveBeenCalledWith(
      { userName: 'alice' },
      'private',
    );
    expect(position).toEqual(
      expect.objectContaining({ symbol: 'BTCUSDT', direction: 'LONG' }),
    );
  });

  it('deduplicates concurrent getPosition requests for the same symbol', async () => {
    type PositionInfoResult = {
      retCode: number;
      result: { list: Array<{ raw: boolean }> };
    };

    let resolvePositionInfo: (value: PositionInfoResult) => void = () => {
      throw new Error(
        'Expected getPositionInfo promise resolver to be captured',
      );
    };
    const client = {
      getPositionInfo: jest.fn(
        () =>
          new Promise<PositionInfoResult>((resolve) => {
            resolvePositionInfo = resolve;
          }),
      ),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedMapPositionData.mockReturnValue([
      { symbol: 'BTCUSDT', price: 100, qty: 1, direction: 'LONG' } as any,
    ]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const firstPromise = connector.getPosition('BTCUSDT');
    const secondPromise = connector.getPosition('BTCUSDT');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getPositionInfo).toHaveBeenCalledTimes(1);

    resolvePositionInfo({
      retCode: 0,
      result: { list: [{ raw: true }] },
    });

    await expect(firstPromise).resolves.toEqual(
      expect.objectContaining({ symbol: 'BTCUSDT', direction: 'LONG' }),
    );
    await expect(secondPromise).resolves.toEqual(
      expect.objectContaining({ symbol: 'BTCUSDT', direction: 'LONG' }),
    );
  });

  it('returns null from getPosition when exchange request throws', async () => {
    const client = {
      getPositionInfo: jest.fn().mockRejectedValue(new Error('socket hang up')),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const position = await connector.getPosition('BTCUSDT');

    expect(position).toBeNull();
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'error',
      'getPositionSnapshot failed: %s %s',
      'BTCUSDT',
      expect.any(Error),
    );
  });

  it('maps open position pnl snapshots from exchange response', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 0,
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              size: '1.5',
              avgPrice: '100',
              markPrice: '120',
              unrealisedPnl: '30',
              side: 'Buy',
            },
            {
              symbol: 'ETHUSDT',
              size: '0',
              avgPrice: '200',
              markPrice: '210',
              unrealisedPnl: '10',
              side: 'Sell',
            },
          ],
        },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const snapshots = await connector.getOpenPositionPnl?.();

    expect(client.getPositionInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.any(String),
        settleCoin: 'USDT',
      }),
    );
    expect(snapshots).toEqual([
      {
        symbol: 'BTCUSDT',
        qty: 1.5,
        price: 100,
        currentPrice: 120,
        unrealizedPnl: 30,
        direction: 'LONG',
      },
    ]);
  });

  it('maps closed pnl snapshots from exchange response', async () => {
    const client = {
      getClosedPnL: jest.fn().mockResolvedValue({
        retCode: 0,
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              qty: '1',
              avgEntryPrice: '100',
              avgExitPrice: '112',
              closedPnl: '12',
              updatedTime: '1700000001000',
              orderId: 'bybit-order-1',
              orderLinkId: 'tjs-order-1',
            },
          ],
        },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const rows = await connector.getClosedPnl?.({
      startTime: 1_700_000_000_000,
      endTime: 1_700_000_100_000,
    });

    expect(client.getClosedPnL).toHaveBeenCalledWith(
      expect.objectContaining({
        category: expect.any(String),
        startTime: 1_700_000_000_000,
        endTime: 1_700_000_100_000,
      }),
    );
    expect(rows).toEqual([
      {
        symbol: 'BTCUSDT',
        qty: 1,
        entryPrice: 100,
        exitPrice: 112,
        closedPnl: 12,
        closedAt: 1_700_000_001_000,
        orderId: 'bybit-order-1',
      },
    ]);
  });

  it('returns false in placeOrder when normalized qty is below min', async () => {
    const client = {
      setLeverage: jest.fn(),
      submitOrder: jest.fn(),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.01,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockReturnValue({ qtyNum: 0.005, qtyStr: '0.005' });

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.placeOrder({
      symbol: 'BTCUSDT',
      price: 100,
      qty: 0.005,
      direction: 'LONG',
      timestamp: Date.now(),
    } as any);

    expect(ok).toBe(false);
    expect(client.setLeverage).not.toHaveBeenCalled();
    expect(client.submitOrder).not.toHaveBeenCalled();
  });

  it('submits market order without TP/SL in the entry request', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.placeOrder({
      symbol: 'BTCUSDT',
      price: 100,
      qty: 1,
      direction: 'LONG',
      orderId: 'tjs-order-1',
      timestamp: Date.now(),
    } as any);

    expect(ok).toBe(true);
    expect(mockedGetClient).toHaveBeenNthCalledWith(
      1,
      { userName: 'alice' },
      'private',
    );
    expect(mockedGetClient).toHaveBeenNthCalledWith(
      2,
      { userName: 'alice' },
      'public',
    );
    expect(client.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '1.000',
        orderLinkId: 'tjs-order-1',
      }),
    );
  });

  it('sets partial take profits in separate calls', async () => {
    const client = {
      setTradingStop: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.setTakeProfits({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      takeProfits: [
        { price: 110, rate: 0.5 },
        { price: 120, rate: 0.5 },
      ],
    });

    expect(ok).toBe(true);
    expect(client.setTradingStop).toHaveBeenCalledTimes(2);
    expect(client.setTradingStop).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tpslMode: 'Partial',
        tpSize: '0.500',
        takeProfit: '110.0',
      }),
    );
  });

  it('treats unchanged take-profit as successful no-op', async () => {
    const client = {
      setTradingStop: jest
        .fn()
        .mockResolvedValue({ retCode: 34040, retMsg: 'not modified' }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.setTakeProfits({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      takeProfits: [{ price: 120, rate: 1 }],
    });

    expect(ok).toBe(true);
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'debug',
      'tp unchanged: %s %s price=%s rate=%s',
      'BTCUSDT',
      'LONG',
      '120.0',
      1,
    );
  });

  it('sets stop loss in a separate call', async () => {
    const client = {
      setTradingStop: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.setStopLoss({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    });

    expect(ok).toBe(true);
    expect(client.setTradingStop).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        tpslMode: 'Full',
        stopLoss: '95.0',
      }),
    );
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'info',
      'sl updated: %s %s stopLoss=%s',
      'BTCUSDT',
      'LONG',
      '95.0',
    );
  });

  it('treats unchanged stop loss as successful no-op', async () => {
    const client = {
      setTradingStop: jest
        .fn()
        .mockResolvedValue({ retCode: 34040, retMsg: 'not modified' }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.setStopLoss({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      stopLossPrice: 95,
    });

    expect(ok).toBe(true);
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'debug',
      'sl unchanged: %s %s stopLoss=%s',
      'BTCUSDT',
      'LONG',
      '95.0',
    );
  });

  it('returns false from closePosition when exchange returns non-zero retCode', async () => {
    const client = {
      submitOrder: jest.fn().mockResolvedValue({ retCode: 10001 }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const ok = await connector.closePosition({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      price: 0,
      timestamp: 0,
    });

    expect(ok).toBe(false);
  });

  it('returns null from getPosition when exchange retCode is non-zero', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 10001,
        result: { list: [] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const position = await connector.getPosition('BTCUSDT');

    expect(position).toBeNull();
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'error',
      'position retCode: %s, %s',
      'BTCUSDT',
      10001,
    );
  });

  it('returns null from getPosition when mapped positions are empty', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 0,
        result: { list: [{ raw: true }] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedMapPositionData.mockReturnValue([]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const position = await connector.getPosition('BTCUSDT');

    expect(position).toBeNull();
    expect(mockedLoggerLog).not.toHaveBeenCalledWith(
      'info',
      'position retCode: %s, %s',
      'BTCUSDT',
      0,
    );
  });

  it('logs compact position snapshots at debug level', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 0,
        result: { list: [{ raw: true }] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedMapPositionData.mockReturnValue([
      { symbol: 'BTCUSDT', price: 100, qty: 1, direction: 'LONG' } as any,
    ]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const position = await connector.getPosition('BTCUSDT');

    expect(position).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        direction: 'LONG',
      }),
    );
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'debug',
      'position: %s %s qty=%s price=%s',
      'BTCUSDT',
      'LONG',
      1,
      100,
    );
  });

  it('returns empty list from getPositions when client is missing', async () => {
    mockedGetClient.mockResolvedValue(null);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const positions = await connector.getPositions();

    expect(positions).toEqual([]);
  });

  it('returns empty list from getPositions when exchange retCode is non-zero', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 10001,
        result: { list: [] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const positions = await connector.getPositions();

    expect(positions).toEqual([]);
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'error',
      'positions retCode: %s, %s',
      10001,
    );
  });

  it('returns empty list from getPositions when mapped data is empty', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 0,
        result: { list: [{ raw: true }] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedMapPositionData.mockReturnValue([]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const positions = await connector.getPositions();

    expect(positions).toEqual([]);
    expect(mockedLoggerLog).not.toHaveBeenCalledWith(
      'info',
      'positions retCode: %s, %s',
      0,
    );
  });

  it('returns mapped positions from getPositions on success', async () => {
    const client = {
      getPositionInfo: jest.fn().mockResolvedValue({
        retCode: 0,
        result: { list: [{ raw: true }] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedMapPositionData.mockReturnValue([
      { symbol: 'BTCUSDT', price: 100, qty: 1, direction: 'LONG' } as any,
    ]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const positions = await connector.getPositions();

    expect(positions).toEqual([
      expect.objectContaining({
        symbol: 'BTCUSDT',
        direction: 'LONG',
      }),
    ]);
  });

  it('returns false from placeOrder when client is missing', async () => {
    mockedGetClient.mockResolvedValue(null);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const ok = await connector.placeOrder({
      symbol: 'BTCUSDT',
      price: 100,
      qty: 1,
      direction: 'LONG',
      timestamp: Date.now(),
    } as any);

    expect(ok).toBe(false);
  });

  it('returns false from placeOrder when submitOrder retCode is non-zero', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest
        .fn()
        .mockResolvedValue({ retCode: 10001, retMsg: 'symbol is invalid' }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));
    const signal = {} as any;

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.placeOrder({
      symbol: 'BTCUSDT',
      price: 100,
      qty: 1,
      direction: 'LONG',
      timestamp: Date.now(),
      signal,
    } as any);

    expect(ok).toBe(false);
    expect(client.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.submitOrder).toHaveBeenCalledTimes(1);
    expect(signal.orderFailureReason).toBe('symbol is invalid');
  });

  it('submits limit order without immediate TP/SL binding', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.placeOrder({
      symbol: 'BTCUSDT',
      price: 100,
      qty: 1,
      direction: 'LONG',
      isLimit: true,
      timestamp: Date.now(),
    } as any);

    expect(ok).toBe(true);
    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: 'Limit',
        price: '100.0',
      }),
    );
  });

  it('uses full TP mode for single take-profit with rate=1', async () => {
    const client = {
      setTradingStop: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.setTakeProfits({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      takeProfits: [{ price: 120, rate: 1 }],
    });

    expect(ok).toBe(true);
    expect(client.setTradingStop).toHaveBeenCalledWith(
      expect.objectContaining({
        tpslMode: 'Full',
        tpSize: undefined,
        takeProfit: '120.0',
      }),
    );
  });

  it('skips TP when computed TP size is below min order qty', async () => {
    const client = {
      setTradingStop: jest.fn(),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.5,
      pricePrecision: 1,
      qtyPrecision: 3,
    });
    mockedNormalizeQty.mockImplementation((qty) => ({
      qtyNum: qty,
      qtyStr: qty.toFixed(3),
    }));
    mockedNormalizePrice.mockImplementation((price) => ({
      priceNum: price,
      priceStr: price.toFixed(1),
    }));

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const ok = await connector.setTakeProfits({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      takeProfits: [{ price: 120, rate: 0.1 }],
    });

    expect(ok).toBe(true);
    expect(client.setTradingStop).not.toHaveBeenCalled();
  });

  it('returns false from closePosition when client is missing', async () => {
    mockedGetClient.mockResolvedValue(null);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const ok = await connector.closePosition({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      price: 0,
      timestamp: 0,
    });

    expect(ok).toBe(false);
  });

  it('invalidates cached position snapshot after a successful placeOrder', async () => {
    const client = {
      getPositionInfo: jest
        .fn()
        .mockResolvedValueOnce({
          retCode: 0,
          result: { list: [{ raw: false }] },
        })
        .mockResolvedValueOnce({
          retCode: 0,
          result: { list: [{ raw: true }] },
        }),
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetSymbolMeta.mockResolvedValue({
      tickSize: 0.1,
      qtyStep: 0.001,
      minOrderQty: 0.001,
    } as any);
    mockedNormalizeQty.mockReturnValue({ qtyNum: 1, qtyStr: '1.000' } as any);
    mockedMapPositionData
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { symbol: 'BTCUSDT', price: 100, qty: 1, direction: 'LONG' } as any,
      ]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    expect(await connector.getPosition('BTCUSDT')).toBeNull();

    await expect(
      connector.placeOrder({
        symbol: 'BTCUSDT',
        price: 100,
        qty: 1,
        direction: 'LONG',
        timestamp: Date.now(),
      } as any),
    ).resolves.toBe(true);

    await expect(connector.getPosition('BTCUSDT')).resolves.toEqual(
      expect.objectContaining({ symbol: 'BTCUSDT', direction: 'LONG' }),
    );
    expect(client.getPositionInfo).toHaveBeenCalledTimes(2);
  });

  it('returns true from closePosition and uses opposite side', async () => {
    const client = {
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const ok = await connector.closePosition({
      symbol: 'BTCUSDT',
      direction: 'SHORT',
      price: 0,
      timestamp: 0,
    });

    expect(ok).toBe(true);
    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'Buy',
        reduceOnly: true,
      }),
    );
  });

  it('returns empty list from getTickers when client is missing', async () => {
    mockedGetClient.mockResolvedValue(null);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const tickers = await connector.getTickers();

    expect(tickers).toEqual([]);
  });

  it('normalizes exchange ticker payload in getTickers', async () => {
    const client = {
      getTickers: jest.fn().mockResolvedValue({
        result: {
          list: [
            {
              symbol: 'BTCUSDT',
              lastPrice: '101',
              indexPrice: '100',
              markPrice: '100.5',
              prevPrice24h: '95',
              price24hPcnt: '0.05',
              highPrice24h: '110',
              lowPrice24h: '90',
              prevPrice1h: '99',
              openInterest: '10',
              openInterestValue: '1000',
              turnover24h: '999',
              volume24h: '123456',
              fundingRate: '0.0001',
              nextFundingTime: '1700000000000',
              predictedDeliveryPrice: '0',
              basisRate: '0',
              deliveryFeeRate: '0',
              deliveryTime: '1700000000001',
              ask1Size: '1',
              bid1Price: '100',
              ask1Price: '101',
              bid1Size: '2',
              basis: '0',
              preOpenPrice: '0',
              preQty: '0',
            },
          ],
        },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    const tickers = await connector.getTickers();

    expect(mockedGetClient).toHaveBeenCalledWith(
      { userName: 'alice' },
      'public',
    );
    expect(tickers).toHaveLength(1);
    expect(tickers[0]).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        lastPrice: 101,
        volume24h: 123456,
      }),
    );
  });

  it('getState/setState merges state incrementally', async () => {
    const connector = await ByBitConnectorCreator({ userName: 'alice' });

    expect(await connector.getState()).toEqual({});

    await connector.setState({ a: 1 });
    await connector.setState({ b: 2 });

    expect(await connector.getState()).toEqual({ a: 1, b: 2 });
  });

  it('returns [] in kline when end is not greater than start', async () => {
    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      start: 2000,
      end: 2000,
    });

    expect(result).toEqual([]);
    expect(mockedGetDataEdges).not.toHaveBeenCalled();
  });

  it('kline loads older/newer chunks, refreshes tail and returns final DB range', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(600_000);
    const client = {
      getKline: jest
        .fn()
        .mockResolvedValueOnce({
          result: {
            list: Array.from({ length: 1000 }, () => ({ timestamp: 300_000 })),
          },
        })
        .mockResolvedValueOnce({
          result: {
            list: Array.from({ length: 1000 }, () => ({ timestamp: 240_000 })),
          },
        })
        .mockResolvedValueOnce({
          result: {
            list: [{ timestamp: 540_000 }],
          },
        }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetDataEdges.mockResolvedValue({ min: 240_000, max: 300_000 });
    mockedGetCandlesRange.mockResolvedValue([
      {
        ts: new Date(300_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.2,
        volume: 10,
        turnover: 20,
      } as any,
    ]);
    mockedToRows.mockImplementation(
      (provider, symbol, interval, data) =>
        ({
          provider,
          symbol,
          interval,
          data,
        }) as any,
    );
    mockedUpsertCandles.mockResolvedValue(undefined as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '1',
      start: 60_000,
      end: 600_000,
    });

    expect(client.getKline).toHaveBeenCalledTimes(3);
    expect(mockedUpsertCandles).toHaveBeenCalledTimes(3);
    expect(mockedGetCandlesRange).toHaveBeenCalledWith(
      'bybit',
      'BTCUSDT',
      1,
      60_000,
      600_000,
    );
    expect(result).toEqual([
      expect.objectContaining({
        timestamp: 300_000,
        close: 1.2,
      }),
    ]);

    nowSpy.mockRestore();
  });

  it('warmOnly syncs cache without reading final DB range', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(600_000);
    const client = {
      getKline: jest.fn().mockResolvedValue({
        result: {
          list: [{ timestamp: 540_000 }],
        },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetDataEdges.mockResolvedValue({ min: 540_000, max: 540_000 });
    mockedToRows.mockImplementation(
      (provider, symbol, interval, data) =>
        ({
          provider,
          symbol,
          interval,
          data,
        }) as any,
    );
    mockedUpsertCandles.mockResolvedValue(undefined as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '1',
      start: 540_000,
      end: 600_000,
      warmOnly: true,
      silent: true,
    });

    expect(result).toEqual([]);
    expect(client.getKline).toHaveBeenCalledTimes(2);
    expect(mockedUpsertCandles).toHaveBeenCalledTimes(2);
    expect(mockedGetCandlesRange).not.toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it('fallback request returns [] when normalized end is not greater than start', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    mockedGetClient.mockResolvedValue({
      getKline: jest.fn(),
    } as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      start: Date.now() + 60_000,
      end: undefined as any,
      silent: true,
    });

    expect(result).toEqual([]);
  });

  it('fallback request returns [] when exchange responds without kline list', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    const client = {
      getKline: jest.fn().mockResolvedValue({
        retCode: 10001,
        retMsg: 'symbol is invalid',
        result: {},
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: Date.now(),
    });

    expect(result).toEqual([]);
    expect(client.getKline).toHaveBeenCalledTimes(1);
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'error',
      'empty kline.list for %s %s%s',
      'BTCUSDT',
      '15',
      ': symbol is invalid (retCode: 10001)',
    );
  });

  it('does not emit per-request kline info logs outside TTY by default', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    const client = {
      getKline: jest.fn().mockResolvedValue({
        result: {
          list: [{ timestamp: 2 }, { timestamp: 1 }],
        },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: Date.now(),
    });

    expect(result).toEqual([{ timestamp: 1 }, { timestamp: 2 }]);
    expect(mockedLoggerLog).not.toHaveBeenCalledWith(
      'info',
      '%s %s %s %s',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it('fallback request catches exchange errors and returns []', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    const client = {
      getKline: jest.fn().mockRejectedValue(new Error('exchange timeout')),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: Date.now(),
      silent: true,
    });

    expect(result).toEqual([]);
  });

  it('retries getKline on retCode 10006 using rate-limit reset timestamp', async () => {
    const now = Date.now();
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    const client = {
      getKline: jest
        .fn()
        .mockResolvedValueOnce({
          retCode: 10006,
          retMsg: 'Too many visits. Exceeded the API Rate Limit.',
          result: {},
          rateLimitApi: {
            remainingRequests: 0,
            maxRequests: 10,
            resetAtTimestamp: now + 400,
          },
        })
        .mockResolvedValueOnce({
          result: {
            list: [{ timestamp: 2 }, { timestamp: 1 }],
          },
        }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: Date.now(),
      silent: true,
    });

    expect(result).toEqual([{ timestamp: 1 }, { timestamp: 2 }]);
    expect(client.getKline).toHaveBeenCalledTimes(2);
    expect(mockedDelay).toHaveBeenCalledTimes(1);
    const waitMs = mockedDelay.mock.calls[0]?.[0] ?? 0;
    expect(waitMs).toBeGreaterThanOrEqual(350);
    expect(waitMs).toBeLessThanOrEqual(1_000);
    expect(mockedLoggerLog).toHaveBeenCalledWith(
      'warn',
      'kline rate limited for %s %s: attempt=%s/%s waitMs=%s',
      'BTCUSDT',
      '15',
      1,
      3,
      waitMs,
    );
  });

  it('retries getKline on retCode 10006 with exponential backoff when reset timestamp is missing', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    const client = {
      getKline: jest
        .fn()
        .mockResolvedValueOnce({
          retCode: 10006,
          retMsg: 'Too many visits. Exceeded the API Rate Limit.',
          result: {},
        })
        .mockResolvedValueOnce({
          result: {
            list: [{ timestamp: 2 }, { timestamp: 1 }],
          },
        }),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: Date.now(),
      silent: true,
    });

    expect(result).toEqual([{ timestamp: 1 }, { timestamp: 2 }]);
    expect(client.getKline).toHaveBeenCalledTimes(2);
    expect(mockedDelay).toHaveBeenCalledWith(800);
  });

  it('returns [] when cacheOnly=true and timescale access fails', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    mockedGetClient.mockResolvedValue({
      getKline: jest.fn(),
    } as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      cacheOnly: true,
      end: Date.now(),
    });

    expect(result).toEqual([]);
  });

  it('returns [] when warmOnly=true and timescale access fails without exchange fallback', async () => {
    mockedGetDataEdges.mockRejectedValue(new Error('db down'));
    const client = {
      getKline: jest.fn(),
    };
    mockedGetClient.mockResolvedValue(client as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      warmOnly: true,
      end: Date.now(),
    });

    expect(result).toEqual([]);
    expect(client.getKline).not.toHaveBeenCalled();
  });

  it('exits fallback mode after successful DB read on next kline call', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(600_000);
    mockedGetDataEdges
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ min: undefined, max: undefined });
    const client = {
      getKline: jest.fn().mockResolvedValue({
        result: { list: [] },
      }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetCandlesRange.mockResolvedValue([]);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const first = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      cacheOnly: true,
      end: 120_000,
    });
    const second = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '15',
      end: 120_000,
      silent: true,
    });

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(mockedGetCandlesRange).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it('kline older loader advances pointer and stops on short chunk', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(600_000);
    const client = {
      getKline: jest
        .fn()
        .mockResolvedValueOnce({
          result: {
            list: Array.from({ length: 1000 }, () => ({ timestamp: 300_000 })),
          },
        })
        .mockResolvedValueOnce({
          result: {
            list: [{ timestamp: 150_000 }],
          },
        }),
    };
    mockedGetClient.mockResolvedValue(client as any);
    mockedGetDataEdges.mockResolvedValue({ min: 200_000, max: 200_000 });
    mockedGetCandlesRange.mockResolvedValue([
      {
        ts: new Date(180_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.1,
        volume: 10,
        turnover: 20,
      } as any,
    ]);
    mockedToRows.mockImplementation(
      (provider, symbol, interval, data) =>
        ({
          provider,
          symbol,
          interval,
          data,
        }) as any,
    );
    mockedUpsertCandles.mockResolvedValue(undefined as any);

    const connector = await ByBitConnectorCreator({ userName: 'alice' });
    const result = await connector.kline({
      symbol: 'BTCUSDT',
      interval: '1',
      start: 100_000,
      end: 160_000,
      silent: true,
    });

    expect(client.getKline).toHaveBeenCalledTimes(2);
    expect(client.getKline).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        start: 60_000,
        end: 200_000,
      }),
    );
    expect(client.getKline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        start: 60_000,
        end: 240_000,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        timestamp: 180_000,
        close: 1.1,
      }),
    ]);

    nowSpy.mockRestore();
  });
});
