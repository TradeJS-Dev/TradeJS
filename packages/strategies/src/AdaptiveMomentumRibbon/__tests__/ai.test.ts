import { adaptiveMomentumRibbonAiAdapter } from '../adapters/ai';

const getLastFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  for (let i = value.length - 1; i >= 0; i -= 1) {
    const current = value[i];
    if (typeof current === 'number' && Number.isFinite(current)) {
      return current;
    }
  }

  return null;
};

const withBaseContext = (signal: any) => ({
  ...signal,
  additionalIndicators: {
    ...signal.additionalIndicators,
    baseContext: {
      ...(signal.additionalIndicators?.baseContext ?? {}),
      raw: {
        ...((signal.additionalIndicators?.baseContext?.raw as Record<
          string,
          unknown
        >) ?? {}),
        trend: {
          ...((signal.additionalIndicators?.baseContext?.raw?.trend as Record<
            string,
            unknown
          >) ?? {}),
          maFast: getLastFiniteNumber(signal.indicators?.maFast),
          maSlow: getLastFiniteNumber(signal.indicators?.maSlow),
        },
      },
      relative: {
        ...((signal.additionalIndicators?.baseContext?.relative as Record<
          string,
          unknown
        >) ?? {}),
        benchmark: {
          ...((signal.additionalIndicators?.baseContext?.relative
            ?.benchmark as Record<string, unknown>) ?? {}),
          maFast: getLastFiniteNumber(signal.indicators?.btcMaFast),
          maSlow: getLastFiniteNumber(signal.indicators?.btcMaSlow),
        },
        targetVsBtc: {
          alphaVsBtc1h: 3.4,
          alphaVsBtc4h: 4.2,
          alphaVsBtc24h: 8,
          ratioTrend: 'up',
          ...((signal.additionalIndicators?.baseContext?.relative
            ?.targetVsBtc as Record<string, unknown>) ?? {}),
        },
      },
      regime: {
        ...((signal.additionalIndicators?.baseContext?.regime as Record<
          string,
          unknown
        >) ?? {}),
        session: {
          sessionPhase: 'off_hours',
          isOverlap: false,
          minutesFromSessionOpen: null,
          minutesToFundingWindow: 60,
          fundingWindowNearby: true,
          ...((signal.additionalIndicators?.baseContext?.regime
            ?.session as Record<string, unknown>) ?? {}),
        },
      },
      derivatives:
        signal.additionalIndicators?.derivativesContext ??
        signal.additionalIndicators?.baseContext?.derivatives,
    },
  },
});

const makeSignal = (overrides: Record<string, any> = {}) =>
  withBaseContext({
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
      baseContext: {
        ...overrides.additionalIndicators?.baseContext,
        candle: {
          open: 100,
          high: 101.2,
          low: 100,
          close: 100.8,
          ...overrides.additionalIndicators?.baseContext?.candle,
        },
        raw: {
          ...overrides.additionalIndicators?.baseContext?.raw,
          volatility: {
            atr: 1,
            ...overrides.additionalIndicators?.baseContext?.raw?.volatility,
          },
        },
        structure: {
          localRange: {
            breakoutState: 'above_high_level',
            ...overrides.additionalIndicators?.baseContext?.structure
              ?.localRange,
          },
          ...overrides.additionalIndicators?.baseContext?.structure,
        },
        participation: {
          volume: {
            volumeRel20: 1.2,
            effortVsResult: 150,
            ...overrides.additionalIndicators?.baseContext?.participation
              ?.volume,
          },
          ...overrides.additionalIndicators?.baseContext?.participation,
        },
        derivatives: {
          ...overrides.additionalIndicators?.baseContext?.derivatives,
          summary: {
            directionAligned: true,
            riskFlags: [],
            ...overrides.additionalIndicators?.baseContext?.derivatives
              ?.summary,
          },
          intervals: {
            ...overrides.additionalIndicators?.baseContext?.derivatives
              ?.intervals,
            '15m': {
              fundingZScore: 0.2,
              ...overrides.additionalIndicators?.baseContext?.derivatives
                ?.intervals?.['15m'],
            },
          },
        },
      },
    },
  } as any);

const buildPayloadForSignal = (signal: any) =>
  adaptiveMomentumRibbonAiAdapter.buildPayload?.({
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

describe('adaptiveMomentumRibbonAiAdapter', () => {
  it('builds strong aligned long context with deterministic approval', () => {
    const signal = makeSignal({
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
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
        signalDirection: 'LONG',
        channelState: 'above_upper',
        channelBiasAligned: true,
        momentumPeriod: 32,
        butterworthSmoothing: 4,
        coinBiasAligned: true,
        btcBiasAligned: true,
        primarySession: 'off_hours',
        sessionAllowsApproval: true,
        signalRangeAtrRatio: expect.closeTo(1.2),
        deterministicQuality: 5,
        approvalAllowedNow: true,
        structuralHardBlockReasons: [],
      }),
    );
  });

  it('demotes strong longs when CMC alt liquidity favors BTC', () => {
    const signal = makeSignal({
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          relative: {
            cmcGlobal: {
              altLiquidityRegime: 'btc_favored',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        signalDirection: 'LONG',
        cmcAltLiquidityRegime: 'btc_favored',
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: ['cmc_alt_liquidity_btc_favored'],
      }),
    );
  });

  it('keeps strong low-effort setups in watch mode when signal range is below 1.05 ATR', () => {
    const signal = makeSignal({
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          candle: {
            open: 100.4,
            high: 100.9,
            low: 100.1,
            close: 100.8,
          },
          raw: {
            volatility: {
              atr: 1,
            },
          },
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
        },
      },
    });

    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        signalRangeAtrRatio: expect.closeTo(0.8),
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: ['weak_signal_range'],
      }),
    );
  });

  it('demotes q4 continuation setups when relative, spread, or CMC context is weak', () => {
    const signal = makeSignal({
      timestamp: Date.UTC(2026, 0, 1, 10, 30),
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc4h: 0.8,
            },
            cmcFearGreed: {
              valueChange7d: -20,
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.3,
              effortVsResult: 110,
            },
          },
        },
        marketContext: {
          execution: {
            binanceCoinbaseSpread: {
              bps: -12,
              bias: 'binance_premium',
              severity: 'elevated',
            },
          },
        },
      },
    });

    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        targetVsBtcAlpha4h: 0.8,
        spreadBps: -12,
        cmcFearGreedValueChange7d: -20,
        cmcBtcDominanceChange24hPct: null,
        q4ContinuationAllowed: false,
        q4ContinuationBlockReasons: [
          'weak_target_vs_btc_alpha_4h',
          'binance_btc_premium_risk',
          'cmc_fear_greed_deteriorating',
        ],
        q4ContinuationRecoveryAllowed: false,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('recovers blocked q4 continuations when effort is low and BTC dominance is not rising', () => {
    const signal = makeSignal({
      timestamp: Date.UTC(2026, 0, 1, 10, 30),
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc4h: 0.8,
            },
            cmcGlobal: {
              btcDominanceChange24hPct: -0.2,
            },
            cmcFearGreed: {
              valueChange7d: -20,
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.3,
              effortVsResult: 50,
            },
          },
        },
        marketContext: {
          execution: {
            binanceCoinbaseSpread: {
              bps: -12,
              bias: 'binance_premium',
              severity: 'elevated',
            },
          },
        },
      },
    });

    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        cmcBtcDominanceChange24hPct: -0.2,
        q4ContinuationAllowed: false,
        q4ContinuationBlockReasons: [
          'weak_target_vs_btc_alpha_4h',
          'binance_btc_premium_risk',
          'cmc_fear_greed_deteriorating',
        ],
        q4ContinuationRecoveryAllowed: true,
        deterministicQuality: 4,
        approvalAllowedNow: true,
      }),
    );
  });

  it('does not cap q5 low-effort setups with the q4 continuation guard', () => {
    const signal = makeSignal({
      timestamp: Date.UTC(2026, 0, 1, 10, 30),
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc4h: 0.8,
            },
            cmcFearGreed: {
              valueChange7d: -20,
            },
          },
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
        },
        marketContext: {
          execution: {
            binanceCoinbaseSpread: {
              bps: -12,
              bias: 'binance_premium',
              severity: 'elevated',
            },
          },
        },
      },
    });

    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        q4ContinuationAllowed: false,
        q4ContinuationBlockReasons: [
          'weak_target_vs_btc_alpha_4h',
          'binance_btc_premium_risk',
          'cmc_fear_greed_deteriorating',
        ],
        deterministicQuality: 5,
        approvalAllowedNow: true,
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
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
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
        targetVsBtcAlpha4h: 0.8,
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

  it('approves strong low-effort inside-channel longs', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.5,
        takeProfitPrice: 103.2,
        stopLossPrice: 99.8,
      },
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
          kcMidline: 100.2,
          kcUpper: 101.1,
          kcLower: 99.5,
          invalidationLevel: 99.9,
        },
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 3.4,
              alphaVsBtc4h: 4.2,
              alphaVsBtc24h: 8,
              ratioTrend: 'up',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'inside_channel',
        targetVsBtcAlpha1h: 3.4,
        targetVsBtcAlpha4h: 4.2,
        volumeRel20: 1,
        effortVsResult: 80,
        deterministicQuality: 5,
        approvalAllowedNow: true,
      }),
    );
  });

  it('keeps low-effort continuations below approval when oscillator is not strong', () => {
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
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
          participation: {
            volume: {
              volumeRel20: 0.6,
              effortVsResult: 60,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'inside_channel',
        targetVsBtcAlpha4h: 0.8,
        volumeRel20: 0.6,
        effortVsResult: 60,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps moderate above-upper longs in watch mode without q5 confirmation', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.4,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
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
        primarySession: 'off_hours',
        sessionAllowsApproval: true,
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: [],
      }),
    );
  });

  it('demotes aligned-bull low-volume q4 continuations to watch mode', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.6,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            benchmark: {
              trendAlignment: 'aligned_bull',
            },
            targetVsBtc: {
              alphaVsBtc1h: 1.4,
              alphaVsBtc4h: 4.2,
              alphaVsBtc24h: 5,
              ratioTrend: 'up',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.4,
              effortVsResult: 160,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'inside_channel',
        benchmarkTrendAlignment: 'aligned_bull',
        volumeRel20: 1.4,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps aligned-bull low-volume high-conviction continuations in q5', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.6,
      },
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          relative: {
            benchmark: {
              trendAlignment: 'aligned_bull',
            },
            targetVsBtc: {
              alphaVsBtc1h: 3.4,
              alphaVsBtc4h: 4.2,
              alphaVsBtc24h: 5,
              ratioTrend: 'up',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.1,
              effortVsResult: 80,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'inside_channel',
        benchmarkTrendAlignment: 'aligned_bull',
        volumeRel20: 1.1,
        deterministicQuality: 5,
        approvalAllowedNow: true,
      }),
    );
  });

  it('demotes q4 longs when derivatives direction is not aligned', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.4,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
        amr: {
          signalOsc: 0.72,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.92,
        },
        derivativesContext: {
          summary: {
            directionAligned: false,
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        derivativesDirectionAligned: false,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes q4 longs when open interest does not confirm the move', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.4,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
        amr: {
          signalOsc: 0.72,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.92,
        },
        derivativesContext: {
          summary: {
            riskFlags: ['oi_not_confirming'],
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        derivativesRiskFlags: ['oi_not_confirming'],
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes q4 longs when funding is too crowded', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.4,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
        amr: {
          signalOsc: 0.72,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.92,
        },
        derivativesContext: {
          intervals: {
            '15m': {
              fundingZScore: 0.9,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        derivativesFundingZScore: 0.9,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps strong local expansion longs in watch mode without q5 confirmation', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.8,
        takeProfitPrice: 104.3,
        stopLossPrice: 99.2,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
          derivatives: {
            summary: {
              directionAligned: null,
              riskFlags: [],
            },
            intervals: {
              '15m': {
                fundingZScore: null,
              },
            },
          },
        },
        amr: {
          signalOsc: 1.18,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.2,
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'above_upper',
        invalidationDistancePct: expect.any(Number),
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps the weak 48/4 local expansion pocket in watch mode', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.8,
        takeProfitPrice: 104.3,
        stopLossPrice: 99.2,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
          derivatives: {
            summary: {
              directionAligned: null,
              riskFlags: [],
            },
            intervals: {
              '15m': {
                fundingZScore: null,
              },
            },
          },
        },
        amr: {
          signalOsc: 1.18,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.2,
        },
        amrConfigSnapshot: {
          momentumPeriod: 48,
          butterworthSmoothing: 4,
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'above_upper',
        momentumPeriod: 48,
        butterworthSmoothing: 4,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes crowded-derivatives longs back to watch mode even from q5 geometry', () => {
    const signal = makeSignal({
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
        derivativesContext: {
          summary: {
            directionAligned: false,
            riskFlags: ['oi_not_confirming'],
            pressure: 'crowded_long',
          },
          intervals: {
            '15m': {
              fundingZScore: 1.3,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        derivativesDirectionAligned: false,
        derivativesRiskFlags: ['oi_not_confirming'],
        derivativesFundingZScore: 1.3,
        derivativesPressure: 'crowded_long',
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: expect.arrayContaining([
          'derivatives_pressure_conflict',
        ]),
      }),
    );
  });

  it('keeps active us-session above-upper longs approved', () => {
    const signal = makeSignal({
      timestamp: Date.UTC(2026, 0, 1, 14, 30),
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
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
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
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
        primarySession: 'us',
        sessionAllowsApproval: true,
        deterministicQuality: 5,
        approvalAllowedNow: true,
        structuralHardBlockReasons: [],
      }),
    );
  });

  it('keeps clean asia-session longs approved but marks the thin session risk', () => {
    const signal = makeSignal({
      timestamp: Date.UTC(2026, 0, 1, 3, 30),
      additionalIndicators: {
        amr: {
          signalOsc: 1.6,
        },
        baseContext: {
          regime: {
            session: {
              sessionPhase: 'asia',
              isOverlap: false,
              minutesFromSessionOpen: 90,
              minutesToFundingWindow: 180,
              fundingWindowNearby: false,
            },
          },
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        channelState: 'above_upper',
        primarySession: 'asia',
        sessionAllowsApproval: false,
        deterministicQuality: 5,
        approvalAllowedNow: true,
        structuralHardBlockReasons: ['session_thin'],
      }),
    );
  });

  it('requires q5 for the slowest 48/6 detector point', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.4,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
        },
        amr: {
          signalOsc: 0.72,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.92,
        },
        amrConfigSnapshot: {
          momentumPeriod: 48,
          butterworthSmoothing: 6,
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
        momentumPeriod: 48,
        butterworthSmoothing: 6,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('demotes q5 longs into watch mode when benchmark, participation, and venue spread conflict', () => {
    const signal = makeSignal({
      additionalIndicators: {
        baseContext: {
          relative: {
            benchmark: {
              relativeStrength1h: -1.6,
              trendAlignment: 'against_benchmark',
            },
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
          participation: {
            volume: {
              volumeRel20: 0.72,
              effortVsResult: -0.24,
            },
          },
          structure: {
            localRange: {
              breakoutRetestQuality: 0.18,
            },
          },
        },
        marketContext: {
          execution: {
            binanceCoinbaseSpread: {
              available: true,
              bps: 8.4,
              bias: 'coinbase_premium',
              severity: 'elevated',
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        benchmarkTrendAlignment: 'against_benchmark',
        benchmarkRelativeStrength1h: -1.6,
        volumeRel20: 0.72,
        effortVsResult: -0.24,
        breakoutRetestQuality: 0.18,
        spreadBps: 8.4,
        spreadSeverity: 'elevated',
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: expect.arrayContaining([
          'benchmark_conflict',
          'weak_participation',
          'weak_retest_quality',
          'elevated_venue_spread',
        ]),
      }),
    );
  });

  it('demotes q4 longs to watch mode when market conflicts stack on a thin session', () => {
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
        baseContext: {
          regime: {
            session: {
              sessionPhase: 'asia',
              isOverlap: false,
              minutesFromSessionOpen: 90,
              minutesToFundingWindow: 180,
              fundingWindowNearby: false,
            },
          },
          relative: {
            benchmark: {
              relativeStrength1h: -1.1,
              trendAlignment: 'against_benchmark',
            },
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
          participation: {
            volume: {
              volumeRel20: 0.8,
            },
          },
        },
        derivativesContext: {
          summary: {
            directionAligned: true,
            riskFlags: [],
          },
          intervals: {
            '15m': {
              fundingZScore: 0.2,
            },
          },
        },
        marketContext: {
          execution: {
            binanceCoinbaseSpread: {
              available: true,
              bps: 22.4,
              bias: 'coinbase_premium',
              severity: 'wide',
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        sessionAllowsApproval: false,
        spreadSeverity: 'wide',
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: expect.arrayContaining([
          'session_thin',
          'benchmark_conflict',
          'elevated_venue_spread',
        ]),
      }),
    );
  });

  it('keeps strong aligned short setups in watch mode while short gate is disabled', () => {
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
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: -3.4,
              alphaVsBtc4h: -4.2,
              alphaVsBtc24h: -8,
              ratioTrend: 'down',
            },
          },
          structure: {
            localRange: {
              breakoutState: 'below_low_level',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1,
              effortVsResult: 80,
            },
          },
        },
        amr: {
          entryLong: 0,
          entryShort: 1,
          invalidated: 0,
          activeBuy: 0,
          activeSell: 1,
          signalOsc: -1.6,
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
        primarySession: 'off_hours',
        sessionAllowsApproval: true,
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: ['short_disabled'],
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
        direction: null,
        quality: 3,
        needRetest: true,
        retestPrice: 99,
        takeProfitPrice: null,
        stopLossPrice: null,
      }),
    );
  });

  it('caps strong longs at q3 when baseContext is missing', () => {
    const signal = makeSignal();
    delete signal.additionalIndicators.baseContext;
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        baseContextAvailable: false,
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: ['missing_base_context'],
      }),
    );
  });

  it('demotes above-upper longs back to watch mode when breakout state stays inside range', () => {
    const signal = makeSignal({
      additionalIndicators: {
        baseContext: {
          structure: {
            localRange: {
              breakoutState: 'inside_range',
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        breakoutState: 'inside_range',
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: expect.arrayContaining([
          'range_bound_structure',
        ]),
      }),
    );
  });

  it('demotes crowded participation pockets even when momentum is strong', () => {
    const signal = makeSignal({
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.4,
              alphaVsBtc4h: 0.8,
              alphaVsBtc24h: 1.2,
              ratioTrend: 'flat',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.84,
              effortVsResult: 640,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        volumeRel20: 1.84,
        effortVsResult: 640,
        deterministicQuality: 3,
        approvalAllowedNow: false,
        structuralHardBlockReasons: expect.arrayContaining([
          'weak_participation',
        ]),
      }),
    );
  });

  it('keeps confirmed breakout sweet-spot above-upper longs in watch mode without q5 confirmation', () => {
    const signal = makeSignal({
      prices: {
        currentPrice: 100.78,
        takeProfitPrice: 103.9,
        stopLossPrice: 99.92,
      },
      additionalIndicators: {
        baseContext: {
          participation: {
            volume: {
              volumeRel20: 1.22,
              effortVsResult: 220,
            },
          },
          derivatives: {
            summary: {
              directionAligned: null,
              riskFlags: [],
            },
            intervals: {
              '15m': {
                fundingZScore: null,
              },
            },
          },
        },
        amr: {
          signalOsc: 0.81,
          kcMidline: 100.2,
          kcUpper: 100.7,
          kcLower: 99.6,
          invalidationLevel: 99.92,
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        breakoutState: 'above_high_level',
        volumeRel20: 1.22,
        effortVsResult: 220,
        derivativesDirectionAligned: null,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });

  it('keeps high-volume participation impulses in watch mode', () => {
    const signal = makeSignal({
      additionalIndicators: {
        baseContext: {
          relative: {
            targetVsBtc: {
              alphaVsBtc1h: 0.2,
              alphaVsBtc4h: 0.4,
              alphaVsBtc24h: 1,
              ratioTrend: 'flat',
            },
          },
          participation: {
            volume: {
              volumeRel20: 2.4,
              effortVsResult: 180,
            },
          },
        },
      },
    });
    const payload = buildPayloadForSignal(signal);

    expect(payload.additionalIndicators.adaptiveMomentumRibbonContext).toEqual(
      expect.objectContaining({
        targetVsBtcAlpha4h: 0.4,
        volumeRel20: 2.4,
        effortVsResult: 180,
        deterministicQuality: 3,
        approvalAllowedNow: false,
      }),
    );
  });
});
