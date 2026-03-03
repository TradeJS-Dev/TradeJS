import { ByBitConnectorCreator } from '..';
import { getClient } from '../client';
import {
  getSymbolMeta,
  mapPositionData,
  normalizePrice,
  normalizeQty,
} from '../utils';
import { getCandlesRange, getDataEdges } from '@utils/timescale';

jest.mock('@utils/logger', () => ({
  logger: {
    log: jest.fn(),
  },
}));

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

jest.mock('@utils/timescale', () => ({
  getCandlesRange: jest.fn(),
  getDataEdges: jest.fn(),
  upsertCandles: jest.fn(),
  toRows: jest.fn((symbol, interval, data) => ({ symbol, interval, data })),
}));

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
});
