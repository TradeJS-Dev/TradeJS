/** @jest-environment node */

import { trendShiftAiAdapter } from '../adapters/ai';

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

describe('trendShiftAiAdapter', () => {
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

  it('keeps q4 SHORT failed_low_breakout in watch mode even when oi divergence and session match the old pocket', () => {
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
});
