/** @jest-environment node */

import { trendFollowAiAdapter } from '../adapters/ai';

const makePayload = (
  context: Record<string, unknown>,
  baseContext: Record<string, unknown> = {},
) => {
  const direction = context.signalDirection === 'SHORT' ? 'SHORT' : 'LONG';

  return {
    signal: {
      symbol: 'TESTUSDT',
      signalId: 'signal-1',
      interval: '15',
      direction,
      timestamp: 1_700_000_000_000,
      strategy: 'TrendFollow',
      prices:
        direction === 'SHORT'
          ? {
              currentPrice: 100,
              takeProfitPrice: 96,
              stopLossPrice: 102,
            }
          : {
              currentPrice: 100,
              takeProfitPrice: 104,
              stopLossPrice: 98,
            },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      trendFollowContext: context,
      baseContext,
    },
  } as any;
};

describe('trendFollowAiAdapter', () => {
  it('approves high-conviction short flush breakouts', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          entryLevel: 100,
          trailStop: 104,
          atr: 1.5,
          pivotKind: 'low',
          breakoutDistancePct: 0.8,
          distanceToStopPct: 2,
          currentPrice: 99,
        },
        {
          regime: {
            session: { sessionPhase: 'off_hours' },
            trend: { bias: 'bull' },
            momentum: { rsi: 32 },
          },
          participation: {
            volume: { volumeRel20: 1.6 },
            volumeStructure: { totalDownVolumeShare: 0.55 },
            delta: { deltaDivergenceVsPrice: 'none' },
          },
          structure: {
            acceptance: { breakoutBodyAtr: 1.6 },
            localRange: { breakoutState: 'below_low_level' },
          },
          derivatives: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
          relative: {
            targetVsBtc: { betaToBtc20: 1.35 },
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

  it('rejects signals without a valid trailing stop', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'SHORT',
        entryLevel: 100,
        atr: 1.5,
        pivotKind: 'low',
        breakoutDistancePct: 0.8,
        distanceToStopPct: 0,
        currentPrice: 99,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 1,
      approved: false,
    });
  });

  it('keeps q4 soft-blocked breakouts in watch mode', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          entryLevel: 100,
          trailStop: 96,
          atr: 1.5,
          pivotKind: 'high',
          breakoutDistancePct: 0.8,
          distanceToStopPct: 2,
          currentPrice: 101,
        },
        {
          participation: {
            volume: { volumeRel20: 0.5 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
        },
      ),
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
    expect((result as any)?.rejectReason).toContain('thin_participation');
  });

  it('keeps weak relative volume breakouts in watch mode', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          entryLevel: 100,
          trailStop: 104,
          atr: 1.5,
          pivotKind: 'low',
          breakoutDistancePct: 0.8,
          distanceToStopPct: 2,
          currentPrice: 99,
        },
        {
          regime: {
            session: { sessionPhase: 'asia' },
          },
          participation: {
            volume: { volumeRel20: 1.2 },
            volumeStructure: { totalDownVolumeShare: 0.55 },
            delta: { deltaDivergenceVsPrice: 'none' },
          },
          structure: {
            acceptance: { breakoutBodyAtr: 1.6 },
            localRange: { breakoutState: 'below_low_level' },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain('weak_relative_volume');
  });

  it('keeps weak downside momentum breakouts in watch mode', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          entryLevel: 100,
          trailStop: 104,
          atr: 1.5,
          pivotKind: 'low',
          breakoutDistancePct: 0.8,
          distanceToStopPct: 2,
          currentPrice: 99,
        },
        {
          regime: {
            session: { sessionPhase: 'asia' },
            momentum: { rsi: 42 },
          },
          participation: {
            volume: { volumeRel20: 1.6 },
            volumeStructure: { totalDownVolumeShare: 0.55 },
            delta: { deltaDivergenceVsPrice: 'none' },
          },
          structure: {
            acceptance: { breakoutBodyAtr: 1.6 },
            localRange: { breakoutState: 'below_low_level' },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain('weak_downside_momentum');
  });

  it('keeps tight ATR stop setups in watch mode', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: {
        ...makePayload(
          {
            signalDirection: 'SHORT',
            entryLevel: 100,
            trailStop: 104,
            atr: 1.5,
            pivotKind: 'low',
            breakoutDistancePct: 0.8,
            distanceToStopPct: 2,
            currentPrice: 99,
          },
          {
            raw: {
              volatility: { atr: 10 },
            },
            regime: {
              session: { sessionPhase: 'asia' },
              momentum: { rsi: 32 },
            },
            participation: {
              volume: { volumeRel20: 1.6 },
              volumeStructure: { totalDownVolumeShare: 0.55 },
              delta: { deltaDivergenceVsPrice: 'none' },
            },
            structure: {
              localRange: { breakoutState: 'below_low_level' },
            },
            derivatives: {
              summary: {
                pressure: 'long_flush',
                directionAligned: true,
                riskFlags: ['long_liquidation_spike'],
              },
            },
          },
        ),
      },
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain(
      'tight_setup_stop_distance_atr',
    );
  });

  it('approves short relative beta continuation pockets', () => {
    const payload = makePayload(
      {
        signalDirection: 'SHORT',
        entryLevel: 100,
        trailStop: 104,
        atr: 1.2,
        pivotKind: 'low',
        breakoutDistancePct: 0.8,
        distanceToStopPct: 2,
        currentPrice: 99,
      },
      {
        raw: {
          volatility: { atr: 1.2 },
        },
        regime: {
          momentum: { rsi: 32 },
        },
        participation: {
          volume: { volumeRel20: 1.6 },
          volumeStructure: { totalDownVolumeShare: 0.55 },
          delta: { deltaDivergenceVsPrice: 'none' },
        },
        structure: {
          localRange: { breakoutState: 'below_low_level' },
        },
        relative: {
          targetVsBtc: { betaToBtc20: 1.35 },
        },
      },
    );

    payload.signal.prices = {
      currentPrice: 100,
      takeProfitPrice: 97.4,
      stopLossPrice: 102,
    };

    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload,
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

  it('approves long relative beta continuation pockets', () => {
    const payload = makePayload(
      {
        signalDirection: 'LONG',
        entryLevel: 100,
        trailStop: 96,
        atr: 1.2,
        pivotKind: 'high',
        breakoutDistancePct: 0.8,
        distanceToStopPct: 2,
        currentPrice: 101,
      },
      {
        raw: {
          volatility: { atr: 1.2 },
        },
        regime: {
          momentum: { rsi: 58 },
        },
        participation: {
          volume: { volumeRel20: 1.6 },
          volumeStructure: { totalUpVolumeShare: 0.55 },
          delta: { deltaDivergenceVsPrice: 'none' },
        },
        structure: {
          localRange: { breakoutState: 'above_high_level' },
        },
        relative: {
          targetVsBtc: { betaToBtc20: 1.35 },
        },
      },
    );

    payload.signal.prices = {
      currentPrice: 100,
      takeProfitPrice: 102.6,
      stopLossPrice: 98,
    };

    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload,
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

  it('rejects relative beta continuation pockets with stop distance at or above 1.9 ATR', () => {
    const payload = makePayload(
      {
        signalDirection: 'SHORT',
        entryLevel: 100,
        trailStop: 104,
        atr: 1.2,
        pivotKind: 'low',
        breakoutDistancePct: 0.8,
        distanceToStopPct: 2,
        currentPrice: 99,
      },
      {
        raw: {
          volatility: { atr: 1.2 },
        },
        regime: {
          momentum: { rsi: 32 },
        },
        participation: {
          volume: { volumeRel20: 1.6 },
          volumeStructure: { totalDownVolumeShare: 0.55 },
          delta: { deltaDivergenceVsPrice: 'none' },
        },
        structure: {
          localRange: { breakoutState: 'below_low_level' },
        },
        relative: {
          targetVsBtc: { betaToBtc20: 1.35 },
        },
      },
    );

    payload.signal.prices = {
      currentPrice: 100,
      takeProfitPrice: 97.4,
      stopLossPrice: 103.2,
    };

    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload,
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });

  it('downgrades adverse delta and weak volume structure', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          entryLevel: 100,
          trailStop: 104,
          atr: 1.5,
          pivotKind: 'low',
          breakoutDistancePct: 0.8,
          distanceToStopPct: 2,
          currentPrice: 99,
        },
        {
          participation: {
            volume: { volumeRel20: 1.6 },
            volumeStructure: { totalDownVolumeShare: 0.44 },
            delta: { deltaDivergenceVsPrice: 'bullish' },
          },
          structure: {
            acceptance: { breakoutBodyAtr: 1.6 },
            localRange: { breakoutState: 'below_low_level' },
          },
        },
      ),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain('adverse_delta_divergence');
    expect((result as any)?.rejectReason).toContain('weak_volume_structure');
  });

  it('uses tuned strategy context instead of conflicting shared trend-follow context', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          entryLevel: 100,
          trailStop: 104,
          atr: 1.5,
          pivotKind: 'low',
          breakoutDistancePct: 0.8,
          distanceToStopPct: 2,
          currentPrice: 99,
        },
        {
          regime: {
            session: { sessionPhase: 'asia' },
            momentum: { rsi: 32 },
            trend: {
              trendFollow: { state: 'bull' },
            },
          },
          participation: {
            volume: { volumeRel20: 1.6 },
            volumeStructure: { totalDownVolumeShare: 0.55 },
            delta: { deltaDivergenceVsPrice: 'none' },
          },
          structure: {
            acceptance: { breakoutBodyAtr: 1.6 },
            localRange: { breakoutState: 'below_low_level' },
          },
          derivatives: {
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
          relative: {
            targetVsBtc: { betaToBtc20: 1.35 },
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
