import { TestConnectorCreator } from '..';
import { setData } from '@utils/redis';

jest.mock('@utils/redis', () => ({
  setData: jest.fn(),
  redisKeys: {
    cacheOrders: (userName: string, orderLogId: string) =>
      `users:${userName}:cache:tests:orders:${orderLogId}`,
    cachePositions: (userName: string, orderLogId: string) =>
      `users:${userName}:cache:tests:positions:${orderLogId}`,
  },
}));

jest.mock('@utils/uuid', () => ({
  uuid: () => 'order-log-id',
}));

const mockedSetData = setData as jest.MockedFunction<typeof setData>;

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
      },
    } as any;

    expect(
      await connector.placeOrder(order, [{ price: 110, rate: 1 }], 95),
    ).toBe(true);
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

    expect(await connector.getPosition('BTCUSDT')).toBeNull();

    const result = await connector.getResult();

    expect(result.orderLogId).toBe('order-log-id');
    expect(result.stat.orders).toBe(1);
    expect(result.stat.amount).toBe(119);
    expect(result.stat.profit).toBe(19);

    expect(mockedSetData).toHaveBeenCalledWith(
      'users:alice:cache:tests:orders:order-log-id',
      expect.any(Array),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
    expect(mockedSetData).toHaveBeenCalledWith(
      'users:alice:cache:tests:positions:order-log-id',
      expect.any(Array),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
  });

  it('applies stop loss for short position and updates final stats', async () => {
    const connector = TestConnectorCreator(createBaseConnector(), {
      userName: 'alice',
    });

    await connector.placeOrder(
      {
        symbol: 'BTCUSDT',
        qty: 1,
        price: 100,
        timestamp: 1_000,
        direction: 'SHORT',
      } as any,
      [],
      105,
    );

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

    expect(result.stat.orders).toBe(1);
    expect(result.stat.amount).toBe(94.5);
    expect(result.stat.profit).toBe(-5.5);
  });

  it('falls back to root user cache when userName is missing', async () => {
    const connector = TestConnectorCreator(createBaseConnector());

    const result = await connector.getResult();

    expect(result.orderLogId).toBe('order-log-id');
    expect(mockedSetData).toHaveBeenCalledWith(
      'users:root:cache:tests:orders:order-log-id',
      expect.any(Array),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
    expect(mockedSetData).toHaveBeenCalledWith(
      'users:root:cache:tests:positions:order-log-id',
      expect.any(Array),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
  });
});
