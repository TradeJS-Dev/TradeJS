import type { Connector, RuntimeTradeRecord } from '@tradejs/types';
import {
  isRuntimeTradeInConnectorScope,
  syncRuntimeTrades,
  type RuntimeTradeStore,
} from '../runtimeTradeSync';

const connector = {
  accountId: 'bybit-default',
  universe: 'crypto',
} as unknown as Connector;

const activeTrade = {
  orderId: 'runtime-order',
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

const createStore = (): jest.Mocked<RuntimeTradeStore> => ({
  getActiveOrderId: jest.fn(
    async (_input: Parameters<RuntimeTradeStore['getActiveOrderId']>[0]) =>
      activeTrade.orderId,
  ),
  saveTrade: jest.fn(
    async (_input: Parameters<RuntimeTradeStore['saveTrade']>[0]) => undefined,
  ),
  saveClosedTrade: jest.fn(
    async (_input: Parameters<RuntimeTradeStore['saveClosedTrade']>[0]) =>
      undefined,
  ),
  deleteActiveTrade: jest.fn(
    async (_input: Parameters<RuntimeTradeStore['deleteActiveTrade']>[0]) =>
      undefined,
  ),
});

describe('runtime trade sync', () => {
  it('matches account-scoped trades to their connector', () => {
    expect(isRuntimeTradeInConnectorScope(activeTrade, connector)).toBe(true);
    expect(
      isRuntimeTradeInConnectorScope(
        { ...activeTrade, accountId: 'bybit-alt' },
        connector,
      ),
    ).toBe(false);
  });

  it('updates an active trade through the storage port', async () => {
    const store = createStore();
    const endTime = Date.parse('2026-07-25T12:00:00.000Z');
    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [activeTrade],
      endTime,
      openPositionsReliable: true,
      openPositions: [
        {
          symbol: activeTrade.symbol,
          qty: activeTrade.qty,
          price: activeTrade.entryPrice,
          currentPrice: 0.36,
          unrealizedPnl: 0.92,
          direction: 'SHORT',
          takeProfitPrice: 0.3538,
          stopLossPrice: 0.377,
        },
      ],
      closedPnlRows: [],
      store,
    });

    expect(synced).toEqual([
      expect.objectContaining({
        currentPrice: 0.36,
        currentPnl: 0.92,
        lastSyncedAt: endTime,
      }),
    ]);
    expect(store.saveTrade).toHaveBeenCalledWith({
      userName: 'root',
      trade: expect.objectContaining({ currentPrice: 0.36 }),
      expire: 0,
    });
    expect(store.saveClosedTrade).not.toHaveBeenCalled();
  });

  it('does not fabricate a close while exchange close data is pending', async () => {
    const store = createStore();
    await expect(
      syncRuntimeTrades({
        userName: 'root',
        connector,
        trades: [activeTrade],
        endTime: activeTrade.entryTimestamp + 60_000,
        openPositionsReliable: true,
        openPositions: [],
        closedPnlRows: [],
        store,
      }),
    ).resolves.toEqual([activeTrade]);
    expect(store.saveTrade).not.toHaveBeenCalled();
    expect(store.deleteActiveTrade).not.toHaveBeenCalled();
  });

  it('persists a reconciled close and removes its active reference', async () => {
    const store = createStore();
    const synced = await syncRuntimeTrades({
      userName: 'root',
      connector,
      trades: [{ ...activeTrade, status: 'closed', closedPnl: 0 }],
      endTime: activeTrade.entryTimestamp + 120_000,
      openPositionsReliable: true,
      openPositions: [],
      closedPnlRows: [
        {
          symbol: activeTrade.symbol,
          direction: 'SHORT',
          qty: activeTrade.qty,
          entryPrice: activeTrade.entryPrice,
          exitPrice: 0.35,
          closedPnl: 2,
          closedAt: activeTrade.entryTimestamp + 100_000,
          orderLinkId: activeTrade.orderId,
          openFee: 0.1,
          closeFee: 0.1,
          totalFee: 0.2,
        },
      ],
      store,
    });

    expect(synced).toEqual([
      expect.objectContaining({ status: 'closed', closedPnl: 2 }),
    ]);
    expect(store.saveTrade).toHaveBeenCalledWith(
      expect.objectContaining({ expire: expect.any(Number) }),
    );
    expect(store.saveClosedTrade).toHaveBeenCalledTimes(1);
    expect(store.deleteActiveTrade).toHaveBeenCalledWith({
      userName: 'root',
      symbol: activeTrade.symbol,
      scopeId: 'bybit-default',
    });
  });
});
