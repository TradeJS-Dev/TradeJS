const mockFetchMlThreshold = jest.fn();
const mockBuildMlTrainingRow = jest.fn();
const mockTrimMlTrainingRowWindows = jest.fn();
const mockBuildMlFeatures = jest.fn();
const mockAskAI = jest.fn();

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

jest.mock('../../../../node/src/ai', () => ({
  askAI: (...args: unknown[]) => mockAskAI(...args),
}));

import {
  enrichSignalWithAi,
  enrichSignalWithMl,
  enrichSignalWithMlAi,
} from '../../../../node/src/strategyHelpers/runtime';

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
