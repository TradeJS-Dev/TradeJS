const mockGetStrategyManifest = jest.fn();
const mockTrimSeriesDeep = jest.fn((value: unknown) => ({
  trimmed: value,
}));

jest.mock('../strategy/manifests', () => ({
  getStrategyManifest: (strategy?: string) => mockGetStrategyManifest(strategy),
}));

jest.mock('../aiShared', () => ({
  trimSeriesDeep: (value: unknown) => mockTrimSeriesDeep(value),
}));

import {
  buildAiHumanPromptAddonByStrategy,
  buildAiPayloadByStrategy,
  buildAiSystemPromptAddonByStrategy,
  getStrategyAiAdapter,
  postProcessAiAnalysisByStrategy,
} from '../strategyAdapters/ai';
import { getStrategyMlAdapter } from '../strategyAdapters/ml';

const makeSignal = () =>
  ({
    signalId: 'sig-1',
    symbol: 'BTCUSDT',
    strategy: 'TrendLine',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: { trendLine: [{ from: 1, to: 2 }] },
    additionalIndicators: {
      baseContext: {
        regime: {
          session: {
            sessionPhase: 'us',
            isOverlap: true,
            minutesFromSessionOpen: 90,
            minutesToFundingWindow: 90,
            fundingWindowNearby: false,
          },
        },
        relative: {
          execution: {
            venueSpread: 3,
            venueSpreadZScore: 1.2,
          },
        },
        raw: {
          crossAsset: {
            venueSpread: 3,
          },
        },
      },
    },
    indicators: { maFast: [10, 11, 12] },
    prices: {
      currentPrice: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      riskRatio: 2,
    },
  }) as any;

describe('strategyAdapters utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStrategyManifest.mockReturnValue(undefined);
    mockTrimSeriesDeep.mockImplementation((value: unknown) => ({
      trimmed: value,
    }));
  });

  it('returns default AI and ML adapters when strategy manifest is missing', () => {
    const aiAdapter = getStrategyAiAdapter('Unknown');
    const mlAdapter = getStrategyMlAdapter('Unknown');

    expect(aiAdapter).toEqual({});
    expect(mlAdapter.normalizeStrategyConfig?.({ foo: 1 } as any)).toEqual({
      foo: 1,
    });
    expect(mlAdapter.mapEntryRuntimeFromConfig).toBeUndefined();
  });

  it('merges default ML adapter with strategy ML adapter from manifest', () => {
    const normalizeStrategyConfig = jest.fn((config) => ({
      ...config,
      normalized: true,
    }));
    const mapEntryRuntimeFromConfig = jest.fn(() => ({
      enabled: true,
      mlThreshold: 0.6,
    }));
    mockGetStrategyManifest.mockReturnValue({
      mlAdapter: {
        normalizeStrategyConfig,
        mapEntryRuntimeFromConfig,
      },
    });

    const adapter = getStrategyMlAdapter('TrendLine');

    expect(adapter.normalizeStrategyConfig?.({ foo: 1 } as any)).toEqual({
      foo: 1,
      normalized: true,
    });
    expect(adapter.mapEntryRuntimeFromConfig?.({} as any)).toEqual({
      enabled: true,
      mlThreshold: 0.6,
    });
  });

  it('builds AI payload from base fields when adapter does not override buildPayload', () => {
    const signal = makeSignal();

    const payload = buildAiPayloadByStrategy(signal);

    expect(payload).toEqual({
      signal: {
        symbol: signal.symbol,
        signalId: signal.signalId,
        interval: signal.interval,
        direction: signal.direction,
        timestamp: signal.timestamp,
        strategy: signal.strategy,
        prices: {
          currentPrice: signal.prices.currentPrice,
          takeProfitPrice: signal.prices.takeProfitPrice,
          stopLossPrice: signal.prices.stopLossPrice,
        },
      },
      figures: { trimmed: signal.figures },
      indicators: { trimmed: signal.indicators },
      additionalIndicators: {
        trimmed: expect.objectContaining({
          ...signal.additionalIndicators,
          marketContext: expect.objectContaining({
            execution: expect.objectContaining({
              binanceCoinbaseSpread: expect.objectContaining({
                available: true,
                bps: 30_000,
                bias: 'coinbase_premium',
              }),
            }),
          }),
        }),
      },
    });
    expect(mockTrimSeriesDeep).toHaveBeenCalledTimes(3);
  });

  it('uses adapter buildPayload when provided by strategy manifest', () => {
    const signal = makeSignal();
    const buildPayload = jest.fn(() => ({ fromAdapter: true }));
    mockGetStrategyManifest.mockReturnValue({
      aiAdapter: {
        buildPayload,
      },
    });

    const payload = buildAiPayloadByStrategy(signal);

    expect(payload).toEqual({ fromAdapter: true });
    expect(buildPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
        basePayload: expect.objectContaining({
          signal: expect.objectContaining({
            symbol: 'BTCUSDT',
          }),
        }),
      }),
    );
  });

  it('builds AI prompt addons from adapter and falls back to empty strings', () => {
    const signal = makeSignal();
    mockGetStrategyManifest.mockReturnValue({
      aiAdapter: {
        buildSystemPromptAddon: () => 'SYSTEM_ADDON',
        buildHumanPromptAddon: () => 'HUMAN_ADDON',
      },
    });

    expect(buildAiSystemPromptAddonByStrategy(signal)).toBe('SYSTEM_ADDON');
    expect(buildAiHumanPromptAddonByStrategy(signal, {} as any)).toBe(
      'HUMAN_ADDON',
    );

    mockGetStrategyManifest.mockReturnValue({ aiAdapter: {} });

    expect(buildAiSystemPromptAddonByStrategy(signal)).toBe('');
    expect(buildAiHumanPromptAddonByStrategy(signal, {} as any)).toBe('');
  });

  it('post-processes AI analysis via strategy adapter and falls back to original analysis', () => {
    const signal = makeSignal();
    const postProcessAnalysis = jest.fn(({ analysis }) => ({
      ...analysis,
      direction: null,
      quality: 3,
    }));
    mockGetStrategyManifest.mockReturnValue({
      aiAdapter: {
        postProcessAnalysis,
      },
    });

    const processed = postProcessAiAnalysisByStrategy(signal, {
      direction: 'LONG',
      quality: 5,
    } as any);

    expect(processed).toEqual({
      direction: null,
      quality: 3,
    });
    expect(postProcessAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        signal,
        analysis: {
          direction: 'LONG',
          quality: 5,
        },
        payload: expect.objectContaining({
          signal: expect.objectContaining({
            symbol: 'BTCUSDT',
          }),
        }),
      }),
    );

    mockGetStrategyManifest.mockReturnValue({ aiAdapter: {} });

    expect(
      postProcessAiAnalysisByStrategy(signal, {
        direction: 'LONG',
        quality: 4,
      } as any),
    ).toEqual({
      direction: 'LONG',
      quality: 4,
    });
  });
});
