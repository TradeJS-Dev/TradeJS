const mockDelKey = jest.fn();
const mockGetData = jest.fn();
const mockSetData = jest.fn();
const mockSetHashJsonField = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  delKey: (...args: unknown[]) => mockDelKey(...args),
  getData: (...args: unknown[]) => mockGetData(...args),
  redisKeys: {
    runtimeActiveTrade: (userName: string, symbol: string) =>
      `users:${userName}:runtime:active:${symbol}`,
    runtimeTrade: (userName: string, orderId: string) =>
      `users:${userName}:runtime:trade:${orderId}`,
    runtimeTradeBucket: (userName: string, dayKey: string) =>
      `users:${userName}:runtime:bucket:${dayKey}`,
  },
  setData: (...args: unknown[]) => mockSetData(...args),
  setHashJsonField: (...args: unknown[]) => mockSetHashJsonField(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

import {
  getActiveRuntimeTrade,
  markRuntimeTradeClosed,
} from '../runtimeJournal';

describe('runtimeJournal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads active runtime trade by symbol', async () => {
    const existingTrade = {
      orderId: 'ord-1',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 2,
      entryPrice: 100,
      entryTimestamp: Date.parse('2026-05-31T12:00:00.000Z'),
      status: 'active',
    };
    mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:active:BTCUSDT') {
        return { orderId: 'ord-1' };
      }
      if (key === 'users:root:runtime:trade:ord-1') {
        return existingTrade;
      }
      return fallback;
    });

    await expect(
      getActiveRuntimeTrade({ userName: 'root', symbol: 'BTCUSDT' }),
    ).resolves.toEqual(existingTrade);
  });

  it('clears stale active runtime trade ref when trade record is missing', async () => {
    mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:active:BTCUSDT') {
        return { orderId: 'ord-1' };
      }
      return fallback;
    });

    await expect(
      getActiveRuntimeTrade({ userName: 'root', symbol: 'BTCUSDT' }),
    ).resolves.toBeNull();
    expect(mockDelKey).toHaveBeenCalledWith(
      'users:root:runtime:active:BTCUSDT',
    );
  });

  it('stores exit type and calculated pnl when a runtime trade is closed', async () => {
    const existingTrade = {
      orderId: 'ord-1',
      signalId: 'sig-1',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 2,
      entryPrice: 100,
      entryTimestamp: Date.parse('2026-05-31T12:00:00.000Z'),
      status: 'active',
      currentPrice: 100,
      currentPnl: 0,
    };
    mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:active:BTCUSDT') {
        return { orderId: 'ord-1' };
      }
      if (key === 'users:root:runtime:trade:ord-1') {
        return existingTrade;
      }
      return fallback;
    });

    const closed = await markRuntimeTradeClosed({
      userName: 'root',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      exitPrice: 106,
      exitTimestamp: Date.parse('2026-05-31T13:00:00.000Z'),
      exitType: 'exit',
    });

    expect(closed).toEqual(
      expect.objectContaining({
        status: 'closed',
        closedPnl: 12,
        currentPnl: 12,
        exitPrice: 106,
        exitTimestamp: Date.parse('2026-05-31T13:00:00.000Z'),
        exitType: 'exit',
      }),
    );
    expect(mockSetData).toHaveBeenCalledWith(
      'users:root:runtime:trade:ord-1',
      expect.objectContaining({
        closedPnl: 12,
        exitType: 'exit',
      }),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
    expect(mockSetHashJsonField).toHaveBeenCalledWith(
      expect.stringContaining('users:root:runtime:bucket:'),
      'ord-1',
      expect.objectContaining({
        closedPnl: 12,
        exitType: 'exit',
      }),
      expect.objectContaining({ expire: expect.any(Number) }),
    );
    expect(mockDelKey).toHaveBeenCalledWith(
      'users:root:runtime:active:BTCUSDT',
    );
  });
});
