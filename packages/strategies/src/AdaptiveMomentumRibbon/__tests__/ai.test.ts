import { adaptiveMomentumRibbonAiAdapter } from '../adapters/ai';

const makeSignal = (overrides: Record<string, any> = {}) =>
  ({
    signalId: 'amr-1',
    symbol: 'TESTUSDT',
    strategy: 'AdaptiveMomentumRibbon',
    interval: '15',
    direction: 'LONG',
    timestamp: 1_700_000_000_000,
    figures: {},
    ...overrides,
    prices: {
      currentPrice: 100.8,
      takeProfitPrice: 103,
      stopLossPrice: 99.7,
      riskRatio: 2,
      ...overrides.prices,
    },
    indicators: {
      maFast: [100, 100.4, 100.7],
      maSlow: [99.9, 100.1, 100.3],
      btcMaFast: [50, 50.2, 50.5],
      btcMaSlow: [49.9, 50.0, 50.1],
      ...overrides.indicators,
    },
    additionalIndicators: {
      ...overrides.additionalIndicators,
      amr: {
        entryLong: 1,
        entryShort: 0,
        invalidated: 0,
        activeBuy: 1,
        activeSell: 0,
        signalOsc: 1.05,
        kcMidline: 100.2,
        kcUpper: 100.7,
        kcLower: 99.7,
        invalidationLevel: 99.9,
        ...overrides.additionalIndicators?.amr,
      },
      amrSignalTiming: {
        entryTiming: 'zero_cross',
        waitClose: true,
        confirmOnNextBar: true,
        lookbackBars: 200,
        ...overrides.additionalIndicators?.amrSignalTiming,
      },
      amrConfigSnapshot: {
        momentumPeriod: 32,
        butterworthSmoothing: 4,
        minSignalOscAbs: 0.55,
        requireKcBias: true,
        minBarsBetweenSignals: 12,
        kcLength: 20,
        atrLength: 14,
        atrMultiplier: 2,
        ...overrides.additionalIndicators?.amrConfigSnapshot,
      },
    },
  }) as any;

describe('adaptiveMomentumRibbonAiAdapter', () => {
  it('builds strong aligned long context with deterministic approval', () => {
    const signal = makeSignal();
    const payload = adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        signalDirection: 'LONG',
        channelState: 'above_upper',
        channelBiasAligned: true,
        coinBiasAligned: true,
        btcBiasAligned: true,
        deterministicQuality: 5,
        approvalAllowedNow: true,
        structuralHardBlockReasons: [],
      }),
    );
  });

  it('demotes invalidated long setups into watch mode', () => {
    const signal = makeSignal({
      additionalIndicators: {
        amr: {
          invalidated: 1,
        },
      },
    });
    const payload = adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        invalidated: true,
        deterministicQuality: 2,
        approvalAllowedNow: false,
        structuralHardBlockReasons: ['invalidated'],
      }),
    );

    const analysis = adaptiveMomentumRibbonAiAdapter.postProcessAnalysis?.({
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
        retestPrice: 100.7,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('keeps weak conflicted long setups below approval threshold', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 99.8,
        takeProfitPrice: 101.8,
      },
      indicators: {
        maFast: [99.8, 99.7, 99.6],
        maSlow: [100, 100, 100],
        btcMaFast: [49.8, 49.7, 49.6],
        btcMaSlow: [50, 50, 50],
      },
      additionalIndicators: {
        amr: {
          signalOsc: 0.34,
          kcMidline: 100.1,
          kcUpper: 100.8,
          kcLower: 99.2,
          invalidationLevel: 99.3,
        },
      },
    });
    const payload = adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'below_midline',
        coinBiasAligned: false,
        btcBiasAligned: false,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps strong inside-channel long setups in watch mode until channel expansion', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.5,
        takeProfitPrice: 103.2,
        stopLossPrice: 99.8,
      },
      additionalIndicators: {
        amr: {
          signalOsc: 0.88,
          kcMidline: 100.2,
          kcUpper: 101.1,
          kcLower: 99.5,
          invalidationLevel: 99.9,
        },
      },
    });
    const payload = adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'inside_channel',
        channelBiasAligned: true,
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: [],
      }),
    );

    const analysis = adaptiveMomentumRibbonAiAdapter.postProcessAnalysis?.({
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
        retestPrice: 101.1,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('keeps moderate above-upper longs in q4 without promoting them to q5', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.4,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        amr: {
          signalOsc: 0.72,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.92,
        },
      },
    });
    const payload = adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'above_upper',
        channelBiasAligned: true,
        deterministicQuality: 4,
        approvalAllowedNow: true,
        structuralHardBlockReasons: [],
      }),
    );
  });

  it('approves strong aligned short setups', () => {
    const signal = makeSignal({
      direction: 'SHORT',
      prices: {
        currentPrice: 98.9,
        takeProfitPrice: 96.6,
        stopLossPrice: 99.9,
      },
      indicators: {
        maFast: [100.2, 99.8, 99.3],
        maSlow: [100.1, 100.0, 99.8],
        btcMaFast: [50.2, 49.9, 49.4],
        btcMaSlow: [50.1, 50.0, 49.8],
      },
      additionalIndicators: {
        amr: {
          entryLong: 0,
          entryShort: 1,
          invalidated: 0,
          activeBuy: 0,
          activeSell: 1,
          signalOsc: -0.95,
          kcMidline: 99.5,
          kcUpper: 100.1,
          kcLower: 99.0,
          invalidationLevel: 99.8,
        },
      },
    });
    const payload = adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        signalDirection: 'SHORT',
        channelState: 'below_lower',
        coinBiasAligned: true,
        btcBiasAligned: true,
        deterministicQuality: 5,
        approvalAllowedNow: true,
      }),
    );

    const analysis = adaptiveMomentumRibbonAiAdapter.postProcessAnalysis?.({
      signal,
      payload,
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(analysis).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 5,
        needRetest: false,
        retestPrice: null,
        takeProfitPrice: 96.6,
        stopLossPrice: 99.9,
      }),
    );
  });
});
