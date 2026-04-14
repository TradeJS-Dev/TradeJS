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
    ...overrides,
    prices: {
      currentPrice: 101,
      takeProfitPrice: 104,
      stopLossPrice: 98,
      riskRatio: 2,
      ...overrides.prices,
    },
    indicators: {
      maFast: [100, 101, 102],
      maSlow: [100, 100, 101],
      btcMaFast: [50, 51, 52],
      btcMaSlow: [50, 50.5, 51],
      ...overrides.indicators,
    },
    additionalIndicators: {
      ...overrides.additionalIndicators,
      deltaAtPivot: overrides.additionalIndicators?.deltaAtPivot ?? 120,
      volumeDivergenceThresholds: {
        allowStructureAdvanceEntry: false,
        minDivergenceAmplitudeAtrRatio: 0.35,
        minReclaimPct: 105,
        minConfirmationCandleQuality: 0.58,
        ...overrides.additionalIndicators?.volumeDivergenceThresholds,
      },
      volumeDivergenceSetup: {
        atrPct: 2.1,
        divergenceAmplitudeAtrRatio: 0.7,
        reclaimPct: 210,
        confirmationCandleQuality: 0.72,
        confirmationDistancePct: 1,
        ...overrides.additionalIndicators?.volumeDivergenceSetup,
      },
      divergence: {
        kind: 'bullish',
        pivotLookbackLeft: 2,
        pivotLookbackRight: 1,
        barsBetweenPivotConfirmations: 4,
        ...overrides.additionalIndicators?.divergence,
        currentPivot: {
          index: 6,
          timestamp: 6,
          priceLow: 95,
          priceHigh: 100,
          volumeNorm: 80,
          ...overrides.additionalIndicators?.divergence?.currentPivot,
        },
        previousPivot: {
          index: 4,
          timestamp: 4,
          priceLow: 97,
          priceHigh: 101,
          volumeNorm: 60,
          ...overrides.additionalIndicators?.divergence?.previousPivot,
        },
      },
    },
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
        divergenceAmplitudeAtrRatio: 0.7,
        reclaimPct: 210,
        confirmationCandleQuality: 0.72,
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
        quality: 3,
        needRetest: true,
        retestPrice: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('keeps structure-advance entries in watch mode until confirmation is ready', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 99,
        takeProfitPrice: 104,
        stopLossPrice: 98,
        riskRatio: 2,
      },
      indicators: {
        maFast: [99, 99.2, 99.4],
        maSlow: [100, 100.1, 100.2],
        btcMaFast: [49, 49.2, 49.4],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        deltaAtPivot: 120,
        volumeDivergenceSetup: {
          atrPct: 2.1,
          divergenceAmplitudeAtrRatio: 0.7,
          reclaimPct: 150,
          confirmationCandleQuality: 0.7,
        },
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
        deterministicQuality: 3,
        approvalAllowedNow: false,
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
        direction: null,
        quality: 3,
        needRetest: true,
        retestPrice: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('demotes overheated long confirmation-ready entries from q4 back to q3', () => {
    const signal = makeSignal({
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 2.1,
          divergenceAmplitudeAtrRatio: 2.6,
          reclaimPct: 135,
          confirmationCandleQuality: 0.74,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 80,
          },
          previousPivot: {
            volumeNorm: 40,
          },
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
        divergenceAmplitudeAtrRatio: 2.6,
        volumeDivergenceRatio: 2,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );

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
        quality: 3,
        needRetest: true,
        retestPrice: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('promotes the best confirmation-ready long q3 setups into q4', () => {
    const signal = makeSignal({
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 0.85,
          divergenceAmplitudeAtrRatio: 0.42,
          reclaimPct: 130,
          confirmationCandleQuality: 0.74,
          confirmationDistancePct: 0.8,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 2,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 110,
          },
          previousPivot: {
            volumeNorm: 60,
          },
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
        divergenceAmplitudeAtrRatio: 0.42,
        volumeDivergenceRatio: 110 / 60,
        deterministicQuality: 4,
        approvalAllowedNow: true,
      }),
    );

    const analysis = volumeDivergenceAiAdapter.postProcessAnalysis?.({
      signal,
      payload,
      analysis: {
        direction: 'LONG',
        quality: 4,
      },
    });

    expect(analysis).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 4,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      }),
    );
  });

  it('promotes semi-aligned long q3 confirmations when reclaim and candle quality are strong', () => {
    const signal = makeSignal({
      indicators: {
        maFast: [100, 101, 102],
        maSlow: [100, 100, 101],
        btcMaFast: [50, 49.8, 49.6],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 0.9,
          divergenceAmplitudeAtrRatio: 1.6,
          reclaimPct: 145,
          confirmationCandleQuality: 0.82,
          confirmationDistancePct: 0.7,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 4,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 110,
          },
          previousPivot: {
            volumeNorm: 90,
          },
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
        coinBiasAligned: true,
        btcBiasAligned: false,
        volumeDivergenceRatio: 110 / 90,
        divergenceAmplitudeAtrRatio: 1.6,
        reclaimPct: 145,
        confirmationCandleQuality: 0.82,
        deterministicQuality: 4,
        approvalAllowedNow: true,
      }),
    );

    const analysis = volumeDivergenceAiAdapter.postProcessAnalysis?.({
      signal,
      payload,
      analysis: {
        direction: 'LONG',
        quality: 4,
      },
    });

    expect(analysis).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 4,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      }),
    );
  });

  it('demotes late fully-aligned long confirmations with weak follow-through back to q3', () => {
    const signal = makeSignal({
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 0.72,
          divergenceAmplitudeAtrRatio: 0.85,
          reclaimPct: 165,
          confirmationCandleQuality: 0.82,
          confirmationDistancePct: 0.9,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 5,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 118,
          },
          previousPivot: {
            volumeNorm: 82,
          },
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
        coinBiasAligned: true,
        btcBiasAligned: true,
        confirmationDistancePct: 0.9,
        barsSinceDetection: 5,
        reclaimPct: 165,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes immature double-conflict long confirmations back to q3', () => {
    const signal = makeSignal({
      indicators: {
        maFast: [99, 99.2, 99.4],
        maSlow: [100, 100.1, 100.2],
        btcMaFast: [49, 49.2, 49.4],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 1.1,
          divergenceAmplitudeAtrRatio: 0.7,
          reclaimPct: 150,
          confirmationCandleQuality: 0.72,
          confirmationDistancePct: 0.5,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 1,
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
        coinBiasAligned: false,
        btcBiasAligned: false,
        confirmationDistancePct: 0.5,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes stale double-conflict long confirmations back to q3 even when they are otherwise tidy', () => {
    const signal = makeSignal({
      indicators: {
        maFast: [99, 99.2, 99.4],
        maSlow: [100, 100.1, 100.2],
        btcMaFast: [49, 49.2, 49.4],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 0.7,
          divergenceAmplitudeAtrRatio: 1,
          reclaimPct: 170,
          confirmationCandleQuality: 0.84,
          confirmationDistancePct: 0.8,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 5,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 120,
          },
          previousPivot: {
            volumeNorm: 60,
          },
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
        coinBiasAligned: false,
        btcBiasAligned: false,
        barsSinceDetection: 5,
        confirmationDistancePct: 0.8,
        divergenceAmplitudeAtrRatio: 1,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes late overextended double-conflict long confirmations back to q3', () => {
    const signal = makeSignal({
      indicators: {
        maFast: [99, 99.2, 99.4],
        maSlow: [100, 100.1, 100.2],
        btcMaFast: [49, 49.2, 49.4],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        volumeDivergenceSetup: {
          atrPct: 1.15,
          divergenceAmplitudeAtrRatio: 0.72,
          reclaimPct: 132,
          confirmationCandleQuality: 0.74,
          confirmationDistancePct: 1.9,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 6,
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
        coinBiasAligned: false,
        btcBiasAligned: false,
        confirmationDistancePct: 1.9,
        barsSinceDetection: 6,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes mature double-conflict long confirmations with oversized amplitude back to q3', () => {
    const signal = makeSignal({
      indicators: {
        maFast: [99, 99.2, 99.4],
        maSlow: [100, 100.1, 100.2],
        btcMaFast: [49, 49.2, 49.4],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        deltaAtPivot: -20,
        volumeDivergenceSetup: {
          atrPct: 0.7,
          divergenceAmplitudeAtrRatio: 2.6,
          reclaimPct: 165,
          confirmationCandleQuality: 0.84,
          confirmationDistancePct: 0.7,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 3,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 132,
          },
          previousPivot: {
            volumeNorm: 50,
          },
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
        coinBiasAligned: false,
        btcBiasAligned: false,
        divergenceAmplitudeAtrRatio: 2.6,
        reclaimPct: 165,
        confirmationDistancePct: 0.7,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps mature counter-trend long confirmations eligible when structure and volume are strong', () => {
    const signal = makeSignal({
      indicators: {
        maFast: [99, 99.2, 99.4],
        maSlow: [100, 100.1, 100.2],
        btcMaFast: [49, 49.2, 49.4],
        btcMaSlow: [50, 50.1, 50.2],
      },
      additionalIndicators: {
        deltaAtPivot: -40,
        volumeDivergenceSetup: {
          atrPct: 0.8,
          divergenceAmplitudeAtrRatio: 0.55,
          reclaimPct: 132,
          confirmationCandleQuality: 0.74,
          confirmationDistancePct: 0.8,
        },
        volumeDivergenceSignalTiming: {
          entryTiming: 'confirmation_ready',
          barsSinceDetection: 3,
        },
        divergence: {
          currentPivot: {
            volumeNorm: 110,
          },
          previousPivot: {
            volumeNorm: 50,
          },
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
        coinBiasAligned: false,
        btcBiasAligned: false,
        deltaAligned: false,
        confirmationDistancePct: 0.8,
        volumeDivergenceRatio: 2.2,
        deterministicQuality: 4,
        approvalAllowedNow: true,
      }),
    );
  });
});
