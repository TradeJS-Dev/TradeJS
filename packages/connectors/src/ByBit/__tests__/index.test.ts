import { ByBitConnectorCreator } from '..';
import { getClient } from '../client';
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
} from '@tradejs/infra';

jest.mock('../client', () => ({
  getClient: jest.fn(),
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

jest.mock('@tradejs/infra', () => {
  const actual = jest.requireActual('@tradejs/infra');
  return {
    ...actual,
    logger: {
      ...actual.logger,
      log: jest.fn(),
    },
    getCandlesRange: jest.fn(),
    getDataEdges: jest.fn(),
    upsertCandles: jest.fn(),
    toRows: jest.fn((symbol, interval, data) => ({ symbol, interval, data })),
  };
});

const mockedGetClient = getClient as jest.MockedFunction<typeof getClient>;
const mockedGetSymbolMeta = getSymbolMeta as jest.MockedFunction<
  typeof getSymbolMeta
>;
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

describe('ByBitConnectorCreator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(position).toEqual(
      expect.objectContaining({ symbol: 'BTCUSDT', direction: 'LONG' }),
    );
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

  it('submits market order and sets partial TP stops', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
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
    const ok = await connector.placeOrder(
      {
        symbol: 'BTCUSDT',
        price: 100,
        qty: 1,
        direction: 'LONG',
        timestamp: Date.now(),
      } as any,
      [
        { price: 110, rate: 0.5 },
        { price: 120, rate: 0.5 },
      ],
      95,
    );

    expect(ok).toBe(true);
    expect(client.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        side: 'Buy',
        orderType: 'Market',
        qty: '1.000',
      }),
    );
    expect(client.setTradingStop).toHaveBeenCalledTimes(2);
    expect(client.setTradingStop).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tpslMode: 'Partial',
        tpSize: '0.500',
      }),
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
      submitOrder: jest.fn().mockResolvedValue({ retCode: 10001 }),
      setTradingStop: jest.fn(),
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
    const ok = await connector.placeOrder(
      {
        symbol: 'BTCUSDT',
        price: 100,
        qty: 1,
        direction: 'LONG',
        timestamp: Date.now(),
      } as any,
      [{ price: 110, rate: 1 }],
      95,
    );

    expect(ok).toBe(false);
    expect(client.setLeverage).toHaveBeenCalledTimes(1);
    expect(client.submitOrder).toHaveBeenCalledTimes(1);
    expect(client.setTradingStop).not.toHaveBeenCalled();
  });

  it('submits limit order and does not place partial TP orders', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
      setTradingStop: jest.fn(),
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
    const ok = await connector.placeOrder(
      {
        symbol: 'BTCUSDT',
        price: 100,
        qty: 1,
        direction: 'LONG',
        isLimit: true,
        timestamp: Date.now(),
      } as any,
      [{ price: 110, rate: 1 }],
      95,
    );

    expect(ok).toBe(true);
    expect(client.submitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: 'Limit',
        price: '100.0',
        takeProfit: '110.0',
        stopLoss: '95.0',
      }),
    );
    expect(client.setTradingStop).not.toHaveBeenCalled();
  });

  it('uses full TP mode for single take-profit with rate=1 in market order', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
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
    const ok = await connector.placeOrder(
      {
        symbol: 'BTCUSDT',
        price: 100,
        qty: 1,
        direction: 'LONG',
        timestamp: Date.now(),
      } as any,
      [{ price: 120, rate: 1 }],
      90,
    );

    expect(ok).toBe(true);
    expect(client.setTradingStop).toHaveBeenCalledWith(
      expect.objectContaining({
        tpslMode: 'Full',
        tpSize: undefined,
        takeProfit: '120.0',
        stopLoss: '90.0',
      }),
    );
  });

  it('skips TP when computed TP size is below min order qty', async () => {
    const client = {
      setLeverage: jest.fn().mockResolvedValue({}),
      submitOrder: jest.fn().mockResolvedValue({ retCode: 0 }),
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
    const ok = await connector.placeOrder(
      {
        symbol: 'BTCUSDT',
        price: 100,
        qty: 1,
        direction: 'LONG',
        timestamp: Date.now(),
      } as any,
      [{ price: 120, rate: 0.1 }],
      90,
    );

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
      (symbol, interval, data) =>
        ({
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
      getKline: jest.fn().mockResolvedValue({ result: {} }),
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
      (symbol, interval, data) =>
        ({
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
