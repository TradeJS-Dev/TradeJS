/** @jest-environment node */

import { trendShiftAiAdapter } from '../adapters/ai';

const makePayload = (
  context: Record<string, unknown>,
  extraIndicators: Record<string, unknown> = {},
) =>
  ({
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
      ...extraIndicators,
    },
  }) as any;

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

  it('approves selective q4 SHORT when derivatives confirm bearish follow-through', () => {
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
          marketContext: {
            tradingSession: {
              primarySession: 'london',
              isOverlap: false,
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
        'derivatives alignment is still unclear, so keep the flip in watch mode',
    });
  });

  it('approves selective q4 LONG when breakout, volume, and derivatives confirm follow-through', () => {
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
      direction: 'LONG',
      quality: 5,
      approved: true,
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
          derivativesContext: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
          marketContext: {
            tradingSession: {
              primarySession: 'london',
              isOverlap: true,
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
