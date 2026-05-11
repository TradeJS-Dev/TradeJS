const mockFetchMlThreshold = jest.fn();
const mockBuildMlTrainingRow = jest.fn();
const mockTrimMlTrainingRowWindows = jest.fn();
const mockBuildMlFeatures = jest.fn();
const mockAskAI = jest.fn();
const mockRunAiPromptLocal = jest.fn();
const mockSetData = jest.fn();
const mockCreateRuntimeOrderId = jest.fn();
const mockRecordRuntimeTradeOpen = jest.fn();

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
    expect(placedSignal.orderId).toBe('tjs-order-1');
    expect(placedSignal.orderStatus).toBe('completed');
    expect(placedSignal.prices.currentPrice).toBe(101);
    expect(mockRecordRuntimeTradeOpen).toHaveBeenCalledWith({
      userName: 'root',
      orderId: 'tjs-order-1',
      signalId: 's1',
      strategy: 'TrendLine',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      qty: 1,
      entryPrice: 101,
      entryTimestamp: 1_700_000_000_000,
    });
    expect(price).toBe(101);
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
