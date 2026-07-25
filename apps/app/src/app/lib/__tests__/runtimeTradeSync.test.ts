import type { Connector, RuntimeTradeRecord } from '@tradejs/types';

const mockDelKey = jest.fn();
const mockGetData = jest.fn();
const mockSetData = jest.fn();
const mockSetHashJsonField = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  delKey: (...args: unknown[]) => mockDelKey(...args),
  getData: (...args: unknown[]) => mockGetData(...args),
  redisKeys: {
    runtimeActiveTrade: (userName: string, symbol: string, scopeId?: string) =>
      `users:${userName}:runtime:active-trades:${scopeId ? `${scopeId}:` : ''}${symbol}`,
    runtimeTrade: (userName: string, orderId: string) =>
      `users:${userName}:runtime:trade-records:${orderId}`,
    runtimeTradeBucket: (userName: string, dayKey: string) =>
      `users:${userName}:runtime:trade-records:days:${dayKey}`,
  },
  setData: (...args: unknown[]) => mockSetData(...args),
  setHashJsonField: (...args: unknown[]) => mockSetHashJsonField(...args),
}));

import {
  isRuntimeTradeInConnectorScope,
  syncRuntimeTrades,
} from '../runtimeTradeSync';

const connector = {
  accountId: 'bybit-default',
  universe: 'crypto',
} as unknown as Connector;

const activeTrade = {
  orderId: 'tjs-liquidityt-genius',
  strategy: 'LiquidityTails',
  symbol: 'GENIUSUSDT',
  direction: 'SHORT',
  qty: 111,
  entryPrice: 0.36835315,
  entryTimestamp: Date.parse('2026-07-25T01:15:00.000Z'),
  status: 'active',
  currentPrice: 0.36835315,
  currentPnl: 0,
  accountId: 'bybit-default',
  universe: 'crypto',
} satisfies RuntimeTradeRecord;

describe('app runtime trade sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetData.mockResolvedValue(null);
    mockSetData.mockResolvedValue(null);
    mockSetHashJsonField.mockResolvedValue(null);
    mockDelKey.mockResolvedValue(true);
  });

  it('matches account-scoped trades to their connector', () => {
    expect(isRuntimeTradeInConnectorScope(activeTrade, connector)).toBe(true);
    expect(
      isRuntimeTradeInConnectorScope(
        { ...activeTrade, accountId: 'bybit-alt' },
        connector,
      ),
    ).toBe(false);
  });

  it('updates scoped active trades in both runtime storage shapes', async () => {
    mockGetData.mockResolvedValue({
      orderId: activeTrade.orderId,
    });

    const endTime = Date.parse('2026-07-25T12:00:00.000Z');
    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [activeTrade],
      endTime,
      openPositionsReliable: true,
      openPositions: [
        {
          symbol: 'GENIUSUSDT',
          qty: 111,
          price: activeTrade.entryPrice,
          currentPrice: 0.36,
          unrealizedPnl: 0.92,
          direction: 'SHORT',
          takeProfitPrice: 0.3538,
          stopLossPrice: 0.377,
        },
      ],
      closedPnlRows: [],
    });

    expect(mockGetData).toHaveBeenCalledWith(
      'users:root:runtime:active-trades:bybit-default:GENIUSUSDT',
      null,
    );
    expect(synced).toEqual([
      expect.objectContaining({
        status: 'active',
        currentPrice: 0.36,
        currentPnl: 0.92,
        lastSyncedAt: endTime,
      }),
    ]);
    expect(mockSetData).toHaveBeenCalledWith(
      `users:root:runtime:trade-records:${activeTrade.orderId}`,
      expect.objectContaining({ currentPrice: 0.36, currentPnl: 0.92 }),
      { expire: 0 },
    );
    expect(mockSetHashJsonField).toHaveBeenCalledWith(
      'users:root:runtime:trade-records:days:2026-07-25',
      activeTrade.orderId,
      expect.objectContaining({ currentPrice: 0.36, currentPnl: 0.92 }),
      { expire: 0 },
    );
  });

  it('does not fabricate a close while exchange close data is pending', async () => {
    mockGetData.mockResolvedValue({
      orderId: activeTrade.orderId,
    });

    await expect(
      syncRuntimeTrades({
        userName: 'root',
        connector,
        trades: [activeTrade],
        endTime: activeTrade.entryTimestamp + 60_000,
        openPositionsReliable: true,
        openPositions: [],
        closedPnlRows: [],
      }),
    ).resolves.toEqual([activeTrade]);

    expect(mockSetData).not.toHaveBeenCalled();
    expect(mockSetHashJsonField).not.toHaveBeenCalled();
    expect(mockDelKey).not.toHaveBeenCalled();
  });

  it('reconciles a fallback close and removes its scoped active ref', async () => {
    const fallbackClosedAt = Date.parse('2026-07-20T18:00:00.619Z');
    const trade = {
      ...activeTrade,
      orderId: 'tjs-liquidityt-manta',
      symbol: 'MANTAUSDT',
      qty: 733.4,
      entryPrice: 0.06527,
      entryTimestamp: Date.parse('2026-07-20T15:15:00.000Z'),
      status: 'closed',
      currentPrice: 0.06527,
      currentPnl: 0,
      closedPnl: 0,
      exitPrice: null,
      actualExitPrice: null,
      exitTimestamp: fallbackClosedAt,
      lastSyncedAt: fallbackClosedAt,
      openFee: 0.047869018,
      closeFee: null,
      fundingFee: null,
      totalFee: 0.047869018,
    } satisfies RuntimeTradeRecord;
    mockGetData.mockResolvedValue({ orderId: trade.orderId });

    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [trade],
      endTime: Date.parse('2026-07-25T12:00:00.000Z'),
      openPositionsReliable: true,
      openPositions: [],
      closedPnlRows: [
        {
          symbol: 'MANTAUSDT',
          direction: 'SHORT',
          qty: 733.4,
          entryPrice: 0.06527,
          exitPrice: 0.06301,
          closedPnl: 1.57741941,
          closedAt: Date.parse('2026-07-21T15:39:42.785Z'),
          orderLinkId: trade.orderId,
          openFee: 0.04786902,
          closeFee: 0.04621155,
          fundingFee: 0.01401598,
          totalFee: 0.10809655,
        },
      ],
    });

    expect(synced).toEqual([
      expect.objectContaining({
        status: 'closed',
        currentPrice: 0.06301,
        closedPnl: 1.57741941,
        actualExitPrice: 0.06301,
        totalFee: 0.10809655,
      }),
    ]);
    expect(mockSetHashJsonField).toHaveBeenCalledWith(
      'users:root:runtime:trade-records:days:2026-07-20',
      trade.orderId,
      expect.objectContaining({ closedPnl: 1.57741941 }),
      { expire: expect.any(Number) },
    );
    expect(mockDelKey).toHaveBeenCalledWith(
      'users:root:runtime:active-trades:bybit-default:MANTAUSDT',
    );
  });
});
