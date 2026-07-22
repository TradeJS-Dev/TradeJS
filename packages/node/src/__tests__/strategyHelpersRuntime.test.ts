const mockFetchMlThreshold = jest.fn();
const mockBuildMlTrainingRow = jest.fn();
const mockTrimMlTrainingRowWindows = jest.fn();
const mockBuildMlFeatures = jest.fn();
const mockAskAI = jest.fn();
const mockRunAiPromptLocal = jest.fn();
const mockSetData = jest.fn();
const mockCreateRuntimeOrderId = jest.fn();
const mockRecordRuntimeTradeOpen = jest.fn();
const mockRecordRuntimeTradeIncrease = jest.fn();
const mockEnrichSignalWithDerivativesContext = jest.fn<
  Promise<boolean>,
  [unknown]
>(async () => true);
const mockEnrichSignalWithBinanceMarketContext = jest.fn<
  Promise<boolean>,
  [unknown]
>(async () => false);
const mockEnrichSignalWithCoinMarketCapContext = jest.fn<
  Promise<boolean>,
  [unknown]
>(async () => false);

jest.mock('@tradejs/infra/ml', () => ({
  buildMlTrainingRow: (...args: unknown[]) => mockBuildMlTrainingRow(...args),
  trimMlTrainingRowWindows: (...args: unknown[]) =>
    mockTrimMlTrainingRowWindows(...args),
  buildMlFeatures: (...args: unknown[]) => mockBuildMlFeatures(...args),
  fetchMlThreshold: (...args: unknown[]) => mockFetchMlThreshold(...args),
}));

jest.mock('@tradejs/infra/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@tradejs/infra/redis', () => ({
  redisKeys: {
    analysis: (symbol: string, signalId: string) =>
      `analysis:${symbol}:${signalId}`,
  },
  setData: (...args: unknown[]) => mockSetData(...args),
}));

jest.mock('../ai', () => ({
  askAI: (...args: unknown[]) => mockAskAI(...args),
  runAiPromptLocal: (...args: unknown[]) => mockRunAiPromptLocal(...args),
}));

jest.mock('../runtimeJournal', () => ({
  createRuntimeOrderId: (...args: unknown[]) =>
    mockCreateRuntimeOrderId(...args),
  recordRuntimeTradeOpen: (...args: unknown[]) =>
    mockRecordRuntimeTradeOpen(...args),
  recordRuntimeTradeIncrease: (...args: unknown[]) =>
    mockRecordRuntimeTradeIncrease(...args),
}));

jest.mock('../strategyHelpers/derivativesContext', () => ({
  enrichSignalWithDerivativesContext: (params: unknown) =>
    mockEnrichSignalWithDerivativesContext(params),
}));

jest.mock('../strategyHelpers/binanceMarketContext', () => ({
  enrichSignalWithBinanceMarketContext: (params: unknown) =>
    mockEnrichSignalWithBinanceMarketContext(params),
}));

jest.mock('../strategyHelpers/coinMarketCapContext', () => ({
  enrichSignalWithCoinMarketCapContext: (params: unknown) =>
    mockEnrichSignalWithCoinMarketCapContext(params),
}));

import {
  enrichSignalWithAi,
  enrichSignalWithMl,
  enrichSignalWithMlAi,
  executeEntryOrder,
} from '../strategyHelpers/runtime';

describe('strategyHelpers/runtime enrichSignalWithMlAi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildMlTrainingRow.mockReturnValue({
      label: 1,
      featureA: 10,
    });
    mockTrimMlTrainingRowWindows.mockReturnValue({
      label: 1,
      featureA: 10,
    });
    mockBuildMlFeatures.mockReturnValue({
      featureA: 10,
    });
    mockAskAI.mockResolvedValue({
      direction: 'LONG',
      quality: 4,
    });
    mockRunAiPromptLocal.mockResolvedValue({
      direction: 'LONG',
      quality: 4,
      comment: 'gate approved',
    });
    mockSetData.mockResolvedValue(null);
    mockCreateRuntimeOrderId.mockReturnValue('tjs-order-1');
    mockRecordRuntimeTradeOpen.mockResolvedValue(null);
    mockFetchMlThreshold.mockResolvedValue({
      probability: 0.9,
      threshold: 0.5,
      passed: true,
    });
  });

  const signal = {
    signalId: 's1',
    symbol: 'ETHUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp: 1,
    figures: {},
    prices: {
      currentPrice: 100,
      takeProfitPrice: 105,
      stopLossPrice: 95,
      riskRatio: 1,
    },
    indicators: {},
  } as any;

  it('skips ML grpc call when ml.enabled is false', async () => {
    const quality = await enrichSignalWithMlAi({
      signal: { ...signal },
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ml: {
        enabled: false,
        strategyConfig: { X: 1 },
        mlThreshold: 0.5,
      } as any,
      ai: { enabled: false },
    });

    expect(mockFetchMlThreshold).not.toHaveBeenCalled();
    expect(mockAskAI).not.toHaveBeenCalled();
    expect(quality).toBeUndefined();
  });

  it('uses signal.strategy and signal.symbol when calling ML grpc', async () => {
    const enrichedSignal = { ...signal };
    await enrichSignalWithMlAi({
      signal: enrichedSignal,
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ml: {
        enabled: true,
        strategyConfig: { TRENDLINE_CONFIG: { minTouches: 4 } },
        mlThreshold: 0.4,
      } as any,
      ai: { enabled: false },
    });

    expect(mockFetchMlThreshold).toHaveBeenCalledTimes(1);
    expect(mockFetchMlThreshold).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'TrendLine',
        threshold: 0.4,
        features: { featureA: 10 },
      }),
    );
  });

  it('enrichSignalWithMl calls ML grpc when enabled', async () => {
    const enrichedSignal = { ...signal };
    await enrichSignalWithMl({
      signal: enrichedSignal,
      env: 'LIVE',
      ml: {
        enabled: true,
        strategyConfig: { TRENDLINE_CONFIG: { minTouches: 4 } },
        mlThreshold: 0.4,
      } as any,
    });

    expect(mockFetchMlThreshold).toHaveBeenCalledTimes(1);
    expect(mockFetchMlThreshold).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'TrendLine',
        threshold: 0.4,
        features: { featureA: 10 },
      }),
    );
  });

  it('returns AI quality when direction matches', async () => {
    const analysis = {
      direction: 'LONG',
      quality: 2,
      comment: 'approved',
    };
    mockAskAI.mockResolvedValue({
      ...analysis,
    });
    const enrichedSignal = { ...signal };

    const quality = await enrichSignalWithMlAi({
      signal: enrichedSignal,
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ai: { enabled: true },
    } as any);

    expect(quality).toBe(2);
    expect(enrichedSignal.aiAnalysis).toEqual(analysis);
  });

  it('penalizes quality to 0 when AI direction mismatches signal direction', async () => {
    mockAskAI.mockResolvedValue({
      direction: null,
      quality: 2,
    });

    const quality = await enrichSignalWithMlAi({
      signal: { ...signal },
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ai: { enabled: true },
    } as any);

    expect(quality).toBe(0);
  });

  it('uses local gate quality in gate mode without LLM request', async () => {
    mockRunAiPromptLocal.mockResolvedValue({
      direction: 'LONG',
      quality: 4,
      comment: 'gate approved',
    });
    const enrichedSignal = { ...signal };

    const quality = await enrichSignalWithAi({
      signal: enrichedSignal,
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ai: { enabled: true, mode: 'gate', minQuality: 4 },
    });

    expect(quality).toBe(4);
    expect(mockRunAiPromptLocal).toHaveBeenCalledTimes(1);
    expect(mockAskAI).not.toHaveBeenCalled();
    expect(enrichedSignal.aiAnalysis).toEqual({
      direction: 'LONG',
      quality: 4,
      comment: 'gate approved',
    });
    expect(mockSetData).not.toHaveBeenCalled();
  });

  it('uses replay AI snapshot in PARITY env without calling provider', async () => {
    const enrichedSignal = { ...signal };

    const quality = await enrichSignalWithAi({
      signal: enrichedSignal,
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'PARITY',
      ai: {
        enabled: true,
        replayAnalyses: [
          {
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp: 1,
            toleranceMs: 15 * 60 * 1000,
            analysis: {
              direction: 'LONG',
              quality: 4,
              comment: 'historical approval',
            },
          },
        ],
      },
    });

    expect(mockAskAI).not.toHaveBeenCalled();
    expect(quality).toBe(4);
    expect(enrichedSignal.aiAnalysis).toEqual({
      direction: 'LONG',
      quality: 4,
      comment: 'historical approval',
    });
  });

  it('penalizes replay AI snapshot when direction mismatches in PARITY env', async () => {
    const quality = await enrichSignalWithAi({
      signal: { ...signal },
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'PARITY',
      ai: {
        enabled: true,
        replayAnalyses: [
          {
            strategy: 'TrendLine',
            symbol: 'ETHUSDT',
            direction: 'LONG',
            timestamp: 1,
            analysis: {
              direction: null,
              quality: 4,
              comment: 'historical reject',
            },
          },
        ],
      },
    });

    expect(mockAskAI).not.toHaveBeenCalled();
    expect(quality).toBe(0);
  });

  it('enrichSignalWithAi returns undefined on AI request error', async () => {
    mockAskAI.mockRejectedValue(new Error('provider 400'));

    const quality = await enrichSignalWithAi({
      signal: { ...signal },
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ai: { enabled: true },
    });

    expect(quality).toBeUndefined();
  });

  it('assigns orderId and records runtime trade after successful entry order', async () => {
    const connector = {
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getTopOfBookTicker: jest.fn(async () => ({
        symbol: 'ETHUSDT',
        bidPrice: 99,
        bidQty: 10,
        askPrice: 101,
        askQty: 12,
      })),
      getPosition: jest.fn(async () => ({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 101,
        direction: 'LONG',
      })),
    } as any;
    const placedSignal = { ...signal };

    const price = await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 100,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 110, rate: 1 }],
      stopLossPrice: 95,
      signal: placedSignal,
    });

    expect(connector.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'ETHUSDT',
        orderId: 'tjs-order-1',
      }),
    );
    expect(mockCreateRuntimeOrderId).toHaveBeenCalledWith('TrendLine');
    expect(placedSignal.orderId).toBe('tjs-order-1');
    expect(placedSignal.orderQty).toBe(1);
    expect(placedSignal.orderValue).toBe(101);
    expect(placedSignal.orderStatus).toBe('completed');
    expect(placedSignal.prices.currentPrice).toBe(101);
    expect(mockRecordRuntimeTradeOpen).toHaveBeenCalledWith({
      userName: 'root',
      orderId: 'tjs-order-1',
      signalId: 's1',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      interval: '15',
      direction: 'LONG',
      qty: 1,
      entryPrice: 101,
      signalTimestamp: 1,
      signalClosePrice: 100,
      arrivalSnapshotTime: expect.any(Number),
      arrivalSource: 'top_of_book',
      arrivalMid: 100,
      bid: 99,
      ask: 101,
      spreadBps: 200,
      orderSubmitTime: expect.any(Number),
      orderAckTime: expect.any(Number),
      fillAvgPrice: 101,
      fillSource: 'exchange_position',
      fillTime: expect.any(Number),
      telemetryQuality: 'full',
      fee: 0.101,
      openFee: 0.101,
      totalFee: 0.101,
      entryTimestamp: 1_700_000_000_000,
    });
    expect(price).toBe(101);
  });

  it('keeps requested order value on signal when entry order fails', async () => {
    const connector = {
      placeOrder: jest.fn(async () => false),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest.fn(async () => null),
    } as any;
    const failedSignal = { ...signal };

    await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1.23,
      currentPrice: 100,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 110, rate: 1 }],
      stopLossPrice: 95,
      signal: failedSignal,
    });

    expect(failedSignal.orderStatus).toBe('failed');
    expect(failedSignal.orderQty).toBe(1.23);
    expect(failedSignal.orderValue).toBe(123);
    expect(mockRecordRuntimeTradeOpen).not.toHaveBeenCalled();
  });

  it('uses connector-adjusted order qty for protection, signal value and journal', async () => {
    const connector = {
      placeOrder: jest.fn(async (order: any) => {
        order.signal.orderQty = 2;
        order.signal.orderValue = 200;
        return true;
      }),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest.fn(async () => ({
        symbol: 'ETHUSDT',
        qty: 2,
        price: 101,
        direction: 'LONG',
      })),
    } as any;
    const placedSignal = { ...signal };

    await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 100,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 110, rate: 1 }],
      stopLossPrice: 95,
      signal: placedSignal,
    });

    expect(connector.setTakeProfits).toHaveBeenCalledWith(
      expect.objectContaining({
        qty: 2,
      }),
    );
    expect(placedSignal.orderQty).toBe(2);
    expect(placedSignal.orderValue).toBe(202);
    expect(mockRecordRuntimeTradeOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        qty: 2,
        entryPrice: 101,
      }),
    );
  });

  it('uses a conservative projected aggregate when an increase position snapshot is stale', async () => {
    const existingPosition = {
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      direction: 'LONG',
    };
    const connector = {
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest.fn(async () => existingPosition),
    } as any;
    const placedSignal = { ...signal };

    const price = await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 90,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 97, rate: 1 }],
      stopLossPrice: 80,
      positionIntent: 'increase',
      signal: placedSignal,
    });

    expect(connector.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ positionIntent: 'increase' }),
    );
    expect(connector.setTakeProfits).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 2 }),
    );
    expect(placedSignal.orderQty).toBe(1);
    expect(placedSignal.orderValue).toBe(90);
    expect(mockRecordRuntimeTradeOpen).not.toHaveBeenCalled();
    expect(mockRecordRuntimeTradeIncrease).toHaveBeenCalledWith(
      expect.objectContaining({
        resultingQty: 2,
        resultingEntryPrice: 95,
        addedQty: 1,
        addedEntryPrice: 90,
      }),
    );
    expect(price).toBe(95);
  });

  it('uses the refreshed aggregate to journal a partial grid increase fill', async () => {
    const previousPosition = {
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      direction: 'LONG',
    };
    const refreshedPosition = {
      symbol: 'ETHUSDT',
      qty: 1.5,
      price: 96,
      direction: 'LONG',
    };
    const connector = {
      placeOrder: jest.fn(async (order: any) => {
        order.signal.orderQty = 0.5;
        return true;
      }),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest
        .fn()
        .mockResolvedValueOnce(previousPosition)
        .mockResolvedValueOnce(refreshedPosition),
    } as any;
    const placedSignal = { ...signal };

    const price = await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 90,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 97, rate: 1 }],
      stopLossPrice: 80,
      positionIntent: 'increase',
      signal: placedSignal,
    });

    expect(connector.setTakeProfits).toHaveBeenCalledWith(
      expect.objectContaining({ qty: 1.5 }),
    );
    expect(connector.setStopLoss).toHaveBeenCalled();
    expect(placedSignal.orderQty).toBe(0.5);
    expect(placedSignal.orderValue).toBe(44);
    expect(placedSignal.prices.currentPrice).toBe(88);
    expect(mockRecordRuntimeTradeIncrease).toHaveBeenCalledWith(
      expect.objectContaining({
        resultingQty: 1.5,
        resultingEntryPrice: 96,
        addedQty: 0.5,
        addedEntryPrice: 88,
        fee: 0.044,
      }),
    );
    expect(price).toBe(96);
  });

  it('records partial fill telemetry when top-of-book is unavailable', async () => {
    const connector = {
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest.fn(async () => null),
    } as any;

    await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 100,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 110, rate: 1 }],
      stopLossPrice: 95,
      signal: { ...signal },
    });

    expect(mockRecordRuntimeTradeOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        arrivalSource: 'unavailable',
        arrivalMid: null,
        fillAvgPrice: 100,
        fillSource: 'requested_price',
        telemetryQuality: 'partial',
      }),
    );
  });

  it('snapshots AI analysis into runtime trade record', async () => {
    const connector = {
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest.fn(async () => ({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 101,
        direction: 'LONG',
      })),
    } as any;
    const aiAnalysis = {
      direction: 'LONG',
      quality: 4,
      comment: 'approved by AI',
    };

    await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 100,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 110, rate: 1 }],
      stopLossPrice: 95,
      signal: {
        ...signal,
        aiAnalysis,
      },
    });

    expect(mockRecordRuntimeTradeOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'tjs-order-1',
        signalId: 's1',
        aiAnalysis,
      }),
    );
  });

  it('can skip runtime trade journaling for replay orders', async () => {
    const connector = {
      placeOrder: jest.fn(async () => true),
      setTakeProfits: jest.fn(async () => true),
      setStopLoss: jest.fn(async () => true),
      closePosition: jest.fn(async () => true),
      getPosition: jest.fn(async () => ({
        symbol: 'ETHUSDT',
        qty: 1,
        price: 101,
        direction: 'LONG',
      })),
    } as any;

    await executeEntryOrder({
      connector,
      userName: 'root',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      currentPrice: 100,
      timestamp: 1_700_000_000_000,
      takeProfits: [{ price: 110, rate: 1 }],
      stopLossPrice: 95,
      signal: { ...signal },
      recordRuntimeTrade: false,
    });

    expect(mockRecordRuntimeTradeOpen).not.toHaveBeenCalled();
  });
});
