/** @jest-environment node */

import { trendShiftAiAdapter } from '../adapters/ai';
import { buildTrendShiftGuardrailContext } from '../guardrails';

const makePayload = (
  context: Record<string, unknown>,
  extraIndicators: Record<string, unknown> = {},
) => {
  const {
    derivativesContext,
    baseContext: baseContextInput,
    ...restExtraIndicators
  } = extraIndicators as Record<string, unknown>;
  const baseContext =
    (baseContextInput as Record<string, unknown> | undefined) ?? {};

  return {
    signal: {
      symbol: 'TESTUSDT',
      signalId: 'signal-1',
      interval: '15',
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      strategy: 'TrendShift',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 103,
        stopLossPrice: 99,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      trendShiftContext: context,
      ...restExtraIndicators,
      baseContext: {
        ...baseContext,
        derivatives:
          (derivativesContext as Record<string, unknown> | undefined) ??
          baseContext.derivatives,
      },
    },
  } as any;
};

const getRejectReason = (result: unknown): string | undefined => {
  const rejectReason = (result as { rejectReason?: unknown } | undefined)
    ?.rejectReason;
  return typeof rejectReason === 'string' ? rejectReason : undefined;
};

describe('trendShiftAiAdapter', () => {
  it('builds strategy-local gate features for narrow q4 recovery discovery', () => {
    const context = buildTrendShiftGuardrailContext({
      signalContext: {
        signalDirection: 'SHORT',
        confirmedFlip: true,
        bearFlip: true,
        flipDistanceOk: true,
        closeVsAvgPct: 0.12,
        avgSlopePct: 0.08,
        distanceAtrRatio: 0.65,
        coinBiasAligned: true,
      },
      baseContext: {
        mtf: {
          summary: {
            mtfAlignment: 'mixed',
          },
        },
        relative: {
          benchmark: {
            relativeStrength1h: 0,
            trendAlignment: 'aligned_bull',
          },
        },
        participation: {
          volume: {
            volumeRel20: 1.2,
          },
        },
        derivatives: {
          summary: {
            pressure: 'long_flush',
            directionAligned: true,
            priceOiDivergenceType: 'price_down_oi_up',
            riskFlags: ['long_liquidation_spike'],
          },
        },
      } as any,
    });

    expect(context.trendShiftGateFeatures).toMatchObject({
      reversalConfirmation: 'confirmed',
      exhaustionSignal: 'liquidation_flush',
      oiConfirmation: 'expanding',
      flipStretch: 'extended',
      q4RecoveryProfile: 'context_supported',
      derivativesReversalAlignment: 'supports_reversal',
      relativeStrengthBucket: 'neutral',
      conflictCount: 2,
      mtfAlignment: 'mixed',
    });
  });

  it('flags noisy overextended flips with conflicting derivatives', () => {
    const context = buildTrendShiftGuardrailContext({
      signalContext: {
        signalDirection: 'SHORT',
        confirmedFlip: false,
        bearFlip: true,
        flipDistanceOk: false,
        closeVsAvgPct: 0.5,
        avgSlopePct: 0.02,
        distanceAtrRatio: 1.35,
        coinBiasAligned: true,
      },
      baseContext: {
        derivatives: {
          summary: {
            pressure: 'neutral',
            directionAligned: false,
            priceOiDivergenceType: 'flat_or_mixed',
            riskFlags: ['oi_not_confirming'],
          },
        },
      } as any,
    });

    expect(context.trendShiftGateFeatures).toMatchObject({
      reversalConfirmation: 'noise',
      exhaustionSignal: 'mixed_oi',
      oiConfirmation: 'mixed',
      flipStretch: 'overextended',
      q4RecoveryProfile: 'none',
      derivativesReversalAlignment: 'conflicts',
    });
  });

  it('adds TrendShift-local gate features to baseContext payload', () => {
    const trendShiftContext = {
      signalDirection: 'SHORT',
      confirmedFlip: true,
      bearFlip: true,
      flipDistanceOk: true,
      closeVsAvgPct: 0.12,
      avgSlopePct: 0.08,
      distanceAtrRatio: 0.65,
      coinBiasAligned: true,
    };
    const basePayload = makePayload(trendShiftContext, {
      baseContext: {
        gateFeatures: {
          volatility: {
            state: 'normal',
            atrPctRankBucket: 'normal',
            bbWidthRankBucket: 'normal',
          },
        },
      },
    });

    const payload = trendShiftAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          trendShiftContext,
        },
      } as any,
      basePayload,
    });

    expect(
      (payload?.additionalIndicators as any).baseContext.trendShiftGateFeatures,
    ).toMatchObject({
      reversalConfirmation: 'confirmed',
      flipStretch: 'extended',
    });
  });

  it('recovers narrow q4 LONG when alt leadership offsets tested OI blockers', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.13,
          avgSlopePct: 0.1,
          distanceAtrRatio: 0.85,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 6,
              },
              relative: {
                btcVsAltReturn24h: -0.006,
                cmcFearGreedValueChange24h: 0,
                cmcFearGreedStale: false,
              },
            },
            relative: {
              btcAltRegime: {
                btcVsAltReturn1h: -0.006,
                stale: false,
              },
              cmcFearGreed: {
                valueChange24h: 0,
                stale: false,
              },
            },
            derivatives: {
              summary: {
                pressure: 'short_flush',
                directionAligned: true,
                priceOiDivergenceType: 'flat_or_mixed',
                riskFlags: [],
              },
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('does not let LONG alt-leadership recovery override CMC liquidity risk', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.13,
          avgSlopePct: 0.1,
          distanceAtrRatio: 0.85,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 6,
              },
              relative: {
                btcVsAltReturn24h: -0.006,
                cmcFearGreedValueChange24h: 0,
                cmcFearGreedStale: false,
                cmcExchangeLiquidityVolumeChange24hPct: 0.2,
                cmcExchangeLiquidityStale: false,
              },
            },
            relative: {
              btcAltRegime: {
                btcVsAltReturn1h: -0.006,
                stale: false,
              },
              cmcFearGreed: {
                valueChange24h: 0,
                stale: false,
              },
            },
            derivatives: {
              summary: {
                pressure: 'short_flush',
                directionAligned: true,
                priceOiDivergenceType: 'flat_or_mixed',
                riskFlags: [],
              },
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'price and open-interest divergence still looks mixed, so keep the flip in watch mode; the expected reward is not large enough relative to current volatility for the defensive TrendShift gate after costs; major-exchange liquidity change is in a historically choppy CMC band, so keep the flip in watch mode',
    });
  });

  it('keeps SHORT extreme ATR and high BB-width flips in watch mode', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              volatility: {
                state: 'normal',
                atrPctRankBucket: 'extreme',
                bbWidthRankBucket: 'high',
              },
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is in a normal-volatility regime but ATR is already extreme with a high Bollinger width, so keep it in watch mode',
    });
  });

  it('keeps q5 SHORT in watch mode while swing structure is still bullish', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            structure: {
              swing: {
                bias: 'bull',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_down_oi_up',
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is still fighting a bullish swing structure, so keep it in watch mode',
    });
  });

  it('keeps low reward-to-volatility flips in watch mode after costs', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 0.2,
              },
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the expected reward is too small relative to current volatility after costs, so keep the flip in watch mode',
    });
  });

  it('keeps sub-defensive reward-to-volatility flips in watch mode', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 4,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect(getRejectReason(result)).toContain(
      'the expected reward is not large enough relative to current volatility for the defensive TrendShift gate after costs',
    );
  });

  it('does not recover sub-defensive reward-to-volatility vetoes', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 4,
              },
            },
            mtf: {
              summary: {
                mtfAlignment: 'mixed',
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: 0,
                trendAlignment: 'aligned_bear',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect(getRejectReason(result)).toContain(
      'the expected reward is not large enough relative to current volatility for the defensive TrendShift gate after costs',
    );
  });

  it('keeps LONG flips in watch mode when BTC-alt regime is BTC-led', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 9,
              },
              relative: {
                btcAltRegime: 'btc_lead',
                btcAltRegimeStale: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is fighting a BTC-led or risk-off alt regime, so keep it in watch mode',
    });
  });

  it('keeps flips in watch mode during choppy CMC exchange-liquidity change', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 9,
              },
              relative: {
                cmcExchangeLiquidityStale: false,
                cmcExchangeLiquidityVolumeChange24hPct: 0.18,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_down_oi_up',
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'major-exchange liquidity change is in a historically choppy CMC band, so keep the flip in watch mode',
    });
  });

  it('keeps broad-market LONG short-flush clusters in watch mode', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 9,
              },
              relative: {
                btcVsAltReturn24h: 0,
              },
            },
            relative: {
              marketBreadth: {
                advancers: 27,
                pctAboveMa20: 0.95,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is chasing a broad-market squeeze while BTC is leading alts and benchmark derivatives show a short flush, so keep it in watch mode',
    });
  });

  it('keeps q5 LONG approval below the broad-market breadth threshold', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 9,
              },
              relative: {
                btcVsAltReturn24h: 0,
              },
            },
            relative: {
              marketBreadth: {
                advancers: 26,
                pctAboveMa20: 0.95,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('keeps Asia SHORT long-flush capitulation clusters in watch mode', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 9,
              },
              relative: {
                cmcFearGreedValue: 18,
                cmcFearGreedStale: false,
                marketBreadthStale: false,
              },
            },
            regime: {
              session: {
                sessionPhase: 'asia',
              },
            },
            relative: {
              marketBreadth: {
                advancers: 2,
              },
              cmcFearGreed: {
                value: 18,
                stale: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is selling an Asia-session long flush while CMC fear/greed and market breadth are already in capitulation, so keep it in watch mode',
    });
  });

  it('keeps q5 Asia SHORT approval above the CMC capitulation threshold', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              setup: {
                rewardToVolatility: 9,
              },
              relative: {
                cmcFearGreedValue: 19,
                cmcFearGreedStale: false,
                marketBreadthStale: false,
              },
            },
            regime: {
              session: {
                sessionPhase: 'asia',
              },
            },
            relative: {
              marketBreadth: {
                advancers: 2,
              },
              cmcFearGreed: {
                value: 19,
                stale: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('approves strong confirmed flips', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              volume: {
                volumeRel20: 1.4,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('rejects ordinary q4 flips as watch-only', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        confirmedFlip: true,
        bullFlip: true,
        flipDistanceOk: true,
        closeVsAvgPct: 0.08,
        avgSlopePct: 0.05,
        distanceAtrRatio: 0.5,
        coinBiasAligned: true,
      }),
      analysis: {
        direction: 'LONG',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('approves q5-strength flips even with coin bias conflict', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 2.6,
          avgSlopePct: 2.8,
          distanceAtrRatio: 0.85,
          coinBiasAligned: false,
        },
        {
          baseContext: {
            participation: {
              volume: {
                volumeRel20: 1.5,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('rejects weak flips even with coin bias conflict', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        confirmedFlip: true,
        bullFlip: true,
        flipDistanceOk: false,
        closeVsAvgPct: 0.02,
        avgSlopePct: 0.01,
        distanceAtrRatio: 0.2,
        coinBiasAligned: false,
      }),
      analysis: {
        direction: 'LONG',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      approved: false,
    });
    expect((result as any).quality).toBe(2);
  });

  it('keeps q5 flip in watch mode when oi is not confirming and there is no flush support', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          derivativesContext: {
            summary: {
              pressure: 'crowded_long',
              directionAligned: false,
              riskFlags: ['oi_not_confirming'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason: 'open interest does not confirm the flip yet',
    });
  });

  it('still approves q5 SHORT when liquidation flush supports the reversal', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: false,
        },
        {
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['oi_not_confirming', 'long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('keeps overextended q5 SHORT in watch mode without long-liquidation flush support', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 1.35,
          coinBiasAligned: true,
        },
        {
          derivativesContext: {
            summary: {
              pressure: 'crowded_long',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip already looks overstretched away from the average without a liquidation flush',
    });
  });

  it('keeps selective q4 SHORT in watch mode even when derivatives confirm bearish follow-through', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.2,
          avgSlopePct: 0.15,
          distanceAtrRatio: 0.75,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
              volatility: {
                atrPctZScore: 0.8,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
            participation: {
              volume: {
                volumeRel20: 1.4,
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: -0.4,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('downgrades q5-looking flip when participation is too thin', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              volume: {
                volumeRel20: 0.6,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'participation is too thin versus recent volume for live approval',
    });
  });

  it('downgrades q5-looking flip when derivatives alignment stays unknown without flush support', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              volume: {
                volumeRel20: 1.3,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'crowded_short',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is running into crowded-short derivatives pressure without a supporting short-liquidation flush',
    });
  });

  it('keeps core q5 LONG in watch mode when crowded-short pressure opposes the flip', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              volume: {
                volumeRel20: 1.2,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'crowded_short',
              directionAligned: true,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is running into crowded-short derivatives pressure without a supporting short-liquidation flush',
    });
  });

  it('keeps core q5 SHORT in watch mode when crowded-short pressure appears on the fresh breakdown', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'crowded_short',
              directionAligned: true,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is running into crowded-short positioning at the breakdown, so keep it in watch mode unless a liquidation flush confirms continuation',
    });
  });

  it('keeps core q5 SHORT in watch mode when crowded-long pressure is present', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          derivativesContext: {
            summary: {
              pressure: 'crowded_long',
              directionAligned: true,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is running into crowded-long derivatives pressure, so keep it in watch mode',
    });
  });

  it('keeps core q5 LONG in watch mode while price is still inside the local range', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            structure: {
              localRange: {
                breakoutState: 'inside_range',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is still inside the local range, so keep it in watch mode',
    });
  });

  it('keeps US-session core q5 LONG in watch mode when short flush lacks OI expansion', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'us',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_up_oi_down',
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the US-session LONG flush still lacks expanding OI confirmation, so keep it in watch mode',
    });
  });

  it('recovers US closing q5 LONG when only OI expansion is missing', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'us',
                sessionWindowPhase: 'closing',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_up_oi_down',
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('keeps Asia-session core q5 LONG short-flush pocket in watch mode', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'asia',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_up_oi_up',
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the Asia-session LONG short-flush pocket is too weak for live approval',
    });
  });

  it('keeps core q5 LONG in watch mode when crowded-long pressure is explicitly anti-aligned', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          derivativesContext: {
            summary: {
              pressure: 'crowded_long',
              directionAligned: false,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is running into crowded-long positioning while derivatives still disagree, so keep it in watch mode',
    });
  });

  it('keeps selective q4 LONG in watch mode even when breakout, volume, and derivatives confirm follow-through', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              volatility: {
                atrPctZScore: 0.7,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'above_high_level',
              },
            },
            participation: {
              volume: {
                volumeRel20: 1.35,
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: 0.2,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('approves selective neutral q4 LONG in Europe above the high level', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'above_high_level',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('approves selective neutral q4 SHORT in off-hours below the low level', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'off_hours',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('approves narrow neutral q4 SHORT breakdowns when the adaptive channel is bearish', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
              volatility: {
                atrPctZScore: 0.5,
              },
              trend: {
                adaptiveChannel: {
                  direction: 'bear',
                },
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('recovers a q5 downgrade when trendShiftGateFeatures show a neutral low-conflict context', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            mtf: {
              summary: {
                mtfAlignment: 'mixed',
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: 0,
                trendAlignment: 'aligned_bear',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('keeps the trendShiftGateFeatures recovery pocket in watch mode when MTF is against the trade', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            mtf: {
              summary: {
                mtfAlignment: 'aligned_bear',
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: 0,
                trendAlignment: 'aligned_bear',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'derivatives pressure is neutral, so the flip still lacks conviction',
    });
  });

  it('recovers US-session SHORT OI non-expansion only when trendShiftGateFeatures agree', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'us',
                isOverlap: false,
              },
            },
            mtf: {
              summary: {
                mtfAlignment: 'mixed',
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: 0,
                trendAlignment: 'aligned_bull',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_down_oi_down',
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('recovers q4 SHORT breadth-shock pockets when 1h short liquidations stay low', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            gateFeatures: {
              relative: {
                marketBreadthReturn: -0.012,
              },
            },
          },
          derivativesContext: {
            intervals: {
              '1h': {
                liqShort: 0.1,
              },
            },
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('keeps breadth-shock SHORT recovery in watch mode when Bollinger width is compressed', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              volatility: {
                bbWidthPct: 1.7,
              },
            },
            gateFeatures: {
              relative: {
                marketBreadthReturn: -0.012,
              },
            },
          },
          derivativesContext: {
            intervals: {
              '1h': {
                liqShort: 0.1,
              },
            },
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is in a narrow Bollinger-width compression pocket that has been less reliable, so keep it in watch mode',
    });
  });

  it('keeps neutral q4 SHORT failed-low breakouts in watch mode even when the adaptive channel is bearish', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
              volatility: {
                atrPctZScore: 0.5,
              },
              trend: {
                adaptiveChannel: {
                  direction: 'bear',
                },
              },
            },
            structure: {
              localRange: {
                breakoutState: 'failed_low_breakout',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('keeps q4 LONG in watch mode when derivatives are aligned but there is no flush confirmation', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              volatility: {
                atrPctZScore: 0.7,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'above_high_level',
              },
            },
            participation: {
              volume: {
                volumeRel20: 1.35,
              },
            },
            relative: {
              benchmark: {
                relativeStrength1h: 0.2,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'crowded_short',
              directionAligned: true,
              riskFlags: [],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('keeps q4 SHORT in watch mode during overlap even with derivatives support', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.2,
          avgSlopePct: 0.15,
          distanceAtrRatio: 0.75,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: true,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('approves narrow asia-session q4 SHORT when neutral pressure still has a real long-liquidation flush', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.13,
          avgSlopePct: 0.09,
          distanceAtrRatio: 0.62,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'asia',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: null,
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('keeps US-session q5 SHORT in watch mode when long-flush pressure lacks expanding OI confirmation', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'us',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_down_oi_down',
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the US-session SHORT flush still lacks expanding OI confirmation, so keep it in watch mode',
    });
  });

  it('keeps US-session q5 SHORT long-flush setup in watch mode even with expanding OI', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'us',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              priceOiDivergenceType: 'price_down_oi_up',
              riskFlags: ['long_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the US-session SHORT long-flush pocket has not been reliable enough for live approval',
    });
  });

  it('keeps q5 LONG in watch mode when relative strength is already overextended', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            relative: {
              benchmark: {
                relativeStrength1h: 6,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is already too extended versus BTC on the 1h relative-strength read',
    });
  });

  it('keeps q5 LONG in watch mode when price rises while OI falls outside the old US-only pocket', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'neutral',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
              priceOiDivergenceType: 'price_up_oi_down',
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is rising while open interest falls, so continuation confirmation is weak',
    });
  });

  it('keeps q5 LONG in watch mode when a lower liquidity tail follows rising price and OI', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            structure: {
              liquidityTails: {
                currentTail: {
                  side: 'lower',
                },
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
              priceOiDivergenceType: 'price_up_oi_up',
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the LONG flip is chasing a lower liquidity tail after price and open interest already expanded',
    });
  });

  it('keeps q5 SHORT below-low long-liquidation flushes in watch mode when OI is falling outside Asia', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: false,
              riskFlags: ['oi_falling', 'long_liquidation_spike'],
              priceOiDivergenceType: 'price_down_oi_down',
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT breakdown is a long-liquidation flush with falling open interest, so continuation confirmation is weak outside Asia',
    });
  });

  it('still approves q5 SHORT below-low long-liquidation flushes with falling OI in Asia', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'asia',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'below_low_level',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: false,
              riskFlags: ['oi_falling', 'long_liquidation_spike'],
              priceOiDivergenceType: 'price_down_oi_down',
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });

  it('keeps q5 SHORT in watch mode near the price-volume point of control', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              priceVolumeProfile: {
                nearPointOfControl: true,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
              priceOiDivergenceType: 'price_down_oi_up',
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT flip is too close to the price-volume point of control, where continuation has been less reliable',
    });
  });

  it('still approves q5 LONG near the price-volume point of control', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              priceVolumeProfile: {
                nearPointOfControl: true,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
              priceOiDivergenceType: 'price_up_oi_up',
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('downgrades q5 flip when price and open interest divergence stays flat_or_mixed', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            participation: {
              volume: {
                volumeRel20: 1.3,
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
              priceOiDivergenceType: 'flat_or_mixed',
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'price and open-interest divergence still looks mixed, so keep the flip in watch mode',
    });
  });

  it('keeps q4 LONG failed_high_breakout in watch mode even when oi divergence and session match the old pocket', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          confirmedFlip: true,
          bullFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'us',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'failed_high_breakout',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'crowded_short',
              directionAligned: true,
              riskFlags: [],
              priceOiDivergenceType: 'price_up_oi_down',
            },
          },
        },
      ),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('keeps q4 SHORT failed_low_breakout in watch mode', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.08,
          avgSlopePct: 0.05,
          distanceAtrRatio: 0.55,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'failed_low_breakout',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'crowded_long',
              directionAligned: true,
              riskFlags: [],
              priceOiDivergenceType: 'price_down_oi_down',
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('keeps q5 SHORT failed_low_breakout in watch mode when OI falls with price', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'europe',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'failed_low_breakout',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
              priceOiDivergenceType: 'price_down_oi_down',
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
      rejectReason:
        'the SHORT failed-low-breakout setup lacks expanding open-interest confirmation',
    });
  });

  it('still approves true q5 SHORT failed_low_breakout when OI confirmation is unknown', () => {
    const result = trendShiftAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          confirmedFlip: true,
          bearFlip: true,
          flipDistanceOk: true,
          closeVsAvgPct: 0.3,
          avgSlopePct: 0.11,
          distanceAtrRatio: 0.95,
          coinBiasAligned: true,
        },
        {
          baseContext: {
            regime: {
              session: {
                sessionPhase: 'off_hours',
                isOverlap: false,
              },
            },
            structure: {
              localRange: {
                breakoutState: 'failed_low_breakout',
              },
            },
          },
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
              priceOiDivergenceType: 'unknown',
            },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 5,
      approved: true,
    });
  });
});
