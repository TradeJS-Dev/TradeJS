const mockDelKey = jest.fn();
const mockGetData = jest.fn();
const mockSetData = jest.fn();
const mockSetHashJsonField = jest.fn();

jest.mock('@tradejs/infra/redis', () => ({
  delKey: (...args: unknown[]) => mockDelKey(...args),
  getData: (...args: unknown[]) => mockGetData(...args),
  redisKeys: {
    runtimeActiveTrade: (
      userName: string,
      symbol: string,
      runtimeScopeId?: string,
    ) =>
      `users:${userName}:runtime:active:${runtimeScopeId ? `${runtimeScopeId}:` : ''}${symbol}`,
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
  recordRuntimeTradeIncrease,
  recordRuntimeTradeOpen,
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

  it('clears an active ref that points to a closed trade record', async () => {
    mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:active:bybit-default:MANTAUSDT') {
        return { orderId: 'ord-manta' };
      }
      if (key === 'users:root:runtime:trade:ord-manta') {
        return {
          orderId: 'ord-manta',
          strategy: 'LiquidityTails',
          symbol: 'MANTAUSDT',
          direction: 'SHORT',
          qty: 733.4,
          entryPrice: 0.06527,
          entryTimestamp: 1,
          status: 'closed',
          closedPnl: 1.57741941,
        };
      }
      return fallback;
    });

    await expect(
      getActiveRuntimeTrade({
        userName: 'root',
        symbol: 'MANTAUSDT',
        accountId: 'bybit-default',
      }),
    ).resolves.toBeNull();
    expect(mockDelKey).toHaveBeenCalledWith(
      'users:root:runtime:active:bybit-default:MANTAUSDT',
    );
  });

  it('stores live execution telemetry when a runtime trade is opened', async () => {
    const opened = await recordRuntimeTradeOpen({
      userName: 'root',
      orderId: 'ord-1',
      signalId: 'sig-1',
      strategy: 'TrendLine',
      symbol: 'BTCUSDT',
      interval: '15' as any,
      direction: 'LONG',
      qty: 2,
      entryPrice: 100.5,
      entryTimestamp: Date.parse('2026-05-31T12:00:00.000Z'),
      signalTimestamp: Date.parse('2026-05-31T11:45:00.000Z'),
      signalClosePrice: 100,
      arrivalSnapshotTime: Date.parse('2026-05-31T12:00:00.900Z'),
      arrivalSource: 'top_of_book',
      arrivalMid: 100.2,
      bid: 100.1,
      ask: 100.3,
      spreadBps: 19.96,
      orderSubmitTime: Date.parse('2026-05-31T12:00:01.000Z'),
      orderAckTime: Date.parse('2026-05-31T12:00:01.500Z'),
      fillAvgPrice: 100.5,
      fillSource: 'exchange_position',
      fillTime: Date.parse('2026-05-31T12:00:02.000Z'),
      telemetryQuality: 'full',
      fee: 0.201,
      openFee: 0.201,
      totalFee: 0.201,
    });

    expect(opened).toEqual(
      expect.objectContaining({
        signalTimestamp: Date.parse('2026-05-31T11:45:00.000Z'),
        signalClosePrice: 100,
        arrivalSnapshotTime: Date.parse('2026-05-31T12:00:00.900Z'),
        arrivalSource: 'top_of_book',
        arrivalMid: 100.2,
        bid: 100.1,
        ask: 100.3,
        spreadBps: 19.96,
        orderSubmitTime: Date.parse('2026-05-31T12:00:01.000Z'),
        orderAckTime: Date.parse('2026-05-31T12:00:01.500Z'),
        fillAvgPrice: 100.5,
        fillSource: 'exchange_position',
        fillTime: Date.parse('2026-05-31T12:00:02.000Z'),
        telemetryQuality: 'full',
        qty: 2,
        symbol: 'BTCUSDT',
        interval: '15',
        fee: 0.201,
        openFee: 0.201,
        totalFee: 0.201,
        entryCount: 1,
        lastEntryPrice: 100.5,
        lastEntryQty: 2,
        lastEntryTimestamp: Date.parse('2026-05-31T12:00:00.000Z'),
      }),
    );
    expect(mockSetData).toHaveBeenCalledWith(
      'users:root:runtime:trade:ord-1',
      expect.objectContaining({
        arrivalSource: 'top_of_book',
        arrivalMid: 100.2,
        fillAvgPrice: 100.5,
        fillSource: 'exchange_position',
        telemetryQuality: 'full',
        fee: 0.201,
      }),
      { expire: 0 },
    );
  });

  it('aggregates a grid increase into the active runtime trade', async () => {
    const existingTrade = {
      orderId: 'ord-grid',
      signalId: 'sig-grid',
      strategy: 'Grid',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 100,
      entryTimestamp: Date.parse('2026-05-31T12:00:00.000Z'),
      entryCount: 1,
      fee: 0.1,
      openFee: 0.1,
      totalFee: 0.1,
      status: 'active',
    };
    mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:active:BTCUSDT') {
        return { orderId: 'ord-grid' };
      }
      if (key === 'users:root:runtime:trade:ord-grid') {
        return existingTrade;
      }
      return fallback;
    });

    await expect(
      recordRuntimeTradeIncrease({
        userName: 'root',
        strategy: 'Grid',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        resultingQty: 2,
        resultingEntryPrice: 95,
        addedQty: 1,
        addedEntryPrice: 90,
        entryTimestamp: Date.parse('2026-05-31T12:15:00.000Z'),
        fee: 0.09,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        orderId: 'ord-grid',
        qty: 2,
        entryPrice: 95,
        entryCount: 2,
        lastEntryPrice: 90,
        lastEntryQty: 1,
        openFee: 0.19,
        totalFee: 0.19,
      }),
    );
    expect(mockSetData).toHaveBeenCalledWith(
      'users:root:runtime:trade:ord-grid',
      expect.objectContaining({ qty: 2, entryCount: 2 }),
      { expire: 0 },
    );
  });

  it('does not create an increase journal entry without a runtime user', async () => {
    await expect(
      recordRuntimeTradeIncrease({
        strategy: 'Grid',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        resultingQty: 2,
        resultingEntryPrice: 95,
        addedQty: 1,
        addedEntryPrice: 90,
        entryTimestamp: 2,
      }),
    ).resolves.toBeNull();

    expect(mockGetData).not.toHaveBeenCalled();
    expect(mockSetData).not.toHaveBeenCalled();
    expect(mockSetHashJsonField).not.toHaveBeenCalled();
  });

  it.each([
    { strategy: 'TrendLine', direction: 'LONG' as const },
    { strategy: 'Grid', direction: 'SHORT' as const },
  ])(
    'rejects an increase when the active trade identity does not match: %o',
    async ({ strategy, direction }) => {
      mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
        if (key === 'users:root:runtime:active:BTCUSDT') {
          return { orderId: 'ord-grid' };
        }
        if (key === 'users:root:runtime:trade:ord-grid') {
          return {
            orderId: 'ord-grid',
            strategy,
            symbol: 'BTCUSDT',
            direction,
            qty: 1,
            entryPrice: 100,
            entryTimestamp: 1,
            status: 'active',
          };
        }
        return fallback;
      });

      await expect(
        recordRuntimeTradeIncrease({
          userName: 'root',
          strategy: 'Grid',
          symbol: 'BTCUSDT',
          direction: 'LONG',
          resultingQty: 2,
          resultingEntryPrice: 95,
          addedQty: 1,
          addedEntryPrice: 90,
          entryTimestamp: 2,
        }),
      ).resolves.toBeNull();

      expect(mockSetData).not.toHaveBeenCalled();
      expect(mockSetHashJsonField).not.toHaveBeenCalled();
    },
  );

  it('isolates active trade refs and metadata by deployment', async () => {
    const opened = await recordRuntimeTradeOpen({
      userName: 'root',
      orderId: 'tradfi-ord-1',
      strategy: 'TrendLine',
      symbol: 'AAPLUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 200,
      entryTimestamp: 100,
      universe: 'tradfi',
      assetClass: 'equity',
      accountId: 'tradfi-main',
      deploymentId: 'tradfi-live',
      policyProfileId: 'tradfi',
    });

    expect(opened).toEqual(
      expect.objectContaining({
        universe: 'tradfi',
        assetClass: 'equity',
        accountId: 'tradfi-main',
        deploymentId: 'tradfi-live',
        policyProfileId: 'tradfi',
      }),
    );
    expect(mockSetData).toHaveBeenCalledWith(
      'users:root:runtime:active:tradfi-live:AAPLUSDT',
      { orderId: 'tradfi-ord-1' },
      { expire: 0 },
    );
  });

  it('loads and closes only the requested deployment active trade', async () => {
    const existingTrade = {
      orderId: 'tradfi-ord-1',
      strategy: 'TrendLine',
      symbol: 'AAPLUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 200,
      entryTimestamp: 100,
      status: 'active',
      deploymentId: 'tradfi-live',
    };
    mockGetData.mockImplementation(async (key: string, fallback: unknown) => {
      if (key === 'users:root:runtime:active:tradfi-live:AAPLUSDT') {
        return { orderId: 'tradfi-ord-1' };
      }
      if (key === 'users:root:runtime:trade:tradfi-ord-1') {
        return existingTrade;
      }
      return fallback;
    });

    await expect(
      getActiveRuntimeTrade({
        userName: 'root',
        symbol: 'AAPLUSDT',
        accountId: 'tradfi-main',
        deploymentId: 'tradfi-live',
      }),
    ).resolves.toEqual(existingTrade);
    await markRuntimeTradeClosed({
      userName: 'root',
      strategy: 'TrendLine',
      symbol: 'AAPLUSDT',
      exitPrice: 205,
      deploymentId: 'tradfi-live',
    });

    expect(mockDelKey).toHaveBeenCalledWith(
      'users:root:runtime:active:tradfi-live:AAPLUSDT',
    );
    expect(mockGetData).not.toHaveBeenCalledWith(
      'users:root:runtime:active:AAPLUSDT',
      expect.anything(),
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
