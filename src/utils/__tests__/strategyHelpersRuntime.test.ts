const mockFetchMlThreshold = jest.fn();
const mockAskAI = jest.fn();

jest.mock('@utils/mlGrpc', () => ({
  fetchMlThreshold: (...args: unknown[]) => mockFetchMlThreshold(...args),
}));

jest.mock('@utils/ai', () => ({
  askAI: (...args: unknown[]) => mockAskAI(...args),
}));

jest.mock('@utils/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

import {
  enrichSignalWithAi,
  enrichSignalWithMl,
  enrichSignalWithMlAi,
} from '@utils/strategyHelpers/runtime';

describe('strategyHelpers/runtime enrichSignalWithMlAi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAskAI.mockResolvedValue({
      direction: 'LONG',
      quality: 4,
    });
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
      enrichedSignal,
      expect.objectContaining({
        strategyConfig: { TRENDLINE_CONFIG: { minTouches: 4 } },
        ML_THRESHOLD: 0.4,
      }),
    );
    const [, configArg] = mockFetchMlThreshold.mock.calls[0];
    expect(configArg.strategyName).toBeUndefined();
    expect(configArg.symbol).toBeUndefined();
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
      enrichedSignal,
      expect.objectContaining({
        strategyConfig: { TRENDLINE_CONFIG: { minTouches: 4 } },
        ML_THRESHOLD: 0.4,
      }),
    );
  });

  it('returns AI quality when direction matches', async () => {
    mockAskAI.mockResolvedValue({
      direction: 'LONG',
      quality: 2,
    });

    const quality = await enrichSignalWithMlAi({
      signal: { ...signal },
      symbol: 'ETHUSDT',
      direction: 'LONG',
      env: 'LIVE',
      ai: { enabled: true },
    } as any);

    expect(quality).toBe(2);
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
});
