import { volumeDivergenceAiAdapter } from '../adapters/ai';

const makeSignal = (overrides: Record<string, any> = {}) =>
  ({
    signalId: 'sig-1',
    symbol: 'TESTUSDT',
    strategy: 'VolumeDivergence',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {},
    prices: {
      currentPrice: 101,
      takeProfitPrice: 104,
      stopLossPrice: 98,
      riskRatio: 2,
    },
    indicators: {
      maFast: [100, 101, 102],
      maSlow: [100, 100, 101],
      btcMaFast: [50, 51, 52],
      btcMaSlow: [50, 50.5, 51],
    },
    additionalIndicators: {
      deltaAtPivot: 120,
      divergence: {
        kind: 'bullish',
        pivotLookbackLeft: 2,
        pivotLookbackRight: 1,
        currentPivot: {
          index: 6,
          timestamp: 6,
          priceLow: 95,
          priceHigh: 100,
          volumeNorm: 80,
        },
        previousPivot: {
          index: 4,
          timestamp: 4,
          priceLow: 97,
          priceHigh: 101,
          volumeNorm: 60,
        },
        barsBetweenPivotConfirmations: 4,
      },
    },
    ...overrides,
  }) as any;

describe('volumeDivergenceAiAdapter', () => {
  it('builds strategy-specific volume divergence context into payload', () => {
    const signal = makeSignal();
    const payload = volumeDivergenceAiAdapter.buildPayload?.({
      signal,
      basePayload: {
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
        figures: {},
        indicators: signal.indicators,
        additionalIndicators: signal.additionalIndicators,
      },
    });

    const context = (payload?.additionalIndicators as any)
      .volumeDivergenceContext;

    expect(context).toEqual(
      expect.objectContaining({
        divergenceKind: 'bullish',
        confirmationPrice: 100,
        confirmationReady: true,
        structureAdvanced: true,
        deltaAligned: true,
        coinBiasAligned: true,
        btcBiasAligned: true,
        deterministicQuality: 4,
        approvalAllowedNow: true,
        structuralHardBlockReasons: [],
        maxAllowedQuality: 4,
      }),
    );
  });

  it('blocks direction when price has not rebounded away from the pivot', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 94,
        takeProfitPrice: 104,
        stopLossPrice: 98,
        riskRatio: 2,
      },
    });
    const payload = volumeDivergenceAiAdapter.buildPayload?.({
      signal,
      basePayload: {
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
        figures: {},
        indicators: signal.indicators,
        additionalIndicators: signal.additionalIndicators,
      },
    }) as any;

    const analysis = volumeDivergenceAiAdapter.postProcessAnalysis?.({
      signal,
      payload,
      analysis: {
        direction: 'LONG',
        quality: 5,
      },
    });

    expect(analysis).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 2,
        needRetest: true,
        retestPrice: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );

    expect(
      (payload.additionalIndicators as any).volumeDivergenceContext,
    ).toEqual(
      expect.objectContaining({
        deterministicQuality: 2,
        approvalAllowedNow: false,
        structuralHardBlockReasons: ['no_rebound_from_pivot'],
      }),
    );
  });

  it('caps quality and forces retest when reversal is not fully confirmed yet', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 99,
        takeProfitPrice: 104,
        stopLossPrice: 98,
        riskRatio: 2,
      },
    });
    const payload = volumeDivergenceAiAdapter.buildPayload?.({
      signal,
      basePayload: {
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
        figures: {},
        indicators: signal.indicators,
        additionalIndicators: signal.additionalIndicators,
      },
    }) as any;

    const analysis = volumeDivergenceAiAdapter.postProcessAnalysis?.({
      signal,
      payload,
      analysis: {
        direction: 'LONG',
        quality: 5,
        needRetest: false,
      },
    });

    expect(analysis).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 4,
        needRetest: true,
        retestPrice: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('approves structure-advance entries produced by the core pending flow', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 99,
        takeProfitPrice: 104,
        stopLossPrice: 98,
        riskRatio: 2,
      },
      additionalIndicators: {
        deltaAtPivot: 120,
        volumeDivergenceSignalTiming: {
          entryTiming: 'structure_advance',
          barsSinceDetection: 2,
        },
        divergence: {
          kind: 'bullish',
          pivotLookbackLeft: 2,
          pivotLookbackRight: 1,
          currentPivot: {
            index: 6,
            timestamp: 6,
            priceLow: 95,
            priceHigh: 100,
            volumeNorm: 80,
          },
          previousPivot: {
            index: 4,
            timestamp: 4,
            priceLow: 97,
            priceHigh: 101,
            volumeNorm: 60,
          },
          barsBetweenPivotConfirmations: 4,
        },
      },
    });
    const payload = volumeDivergenceAiAdapter.buildPayload?.({
      signal,
      basePayload: {
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
        figures: {},
        indicators: signal.indicators,
        additionalIndicators: signal.additionalIndicators,
      },
    }) as any;

    expect(
      (payload.additionalIndicators as any).volumeDivergenceContext,
    ).toEqual(
      expect.objectContaining({
        entryTiming: 'structure_advance',
        barsSinceDetection: 2,
        deterministicQuality: 5,
        approvalAllowedNow: true,
      }),
    );

    const analysis = volumeDivergenceAiAdapter.postProcessAnalysis?.({
      signal,
      payload,
      analysis: {
        direction: 'LONG',
        quality: 5,
        needRetest: true,
      },
    });

    expect(analysis).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 5,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      }),
    );
  });
});
