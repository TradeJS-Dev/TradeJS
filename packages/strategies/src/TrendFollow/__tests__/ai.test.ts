/** @jest-environment node */

import { trendFollowAiAdapter } from '../adapters/ai';

const makePayload = (
  context: Record<string, unknown>,
  baseContext: Record<string, unknown> = {},
) =>
  ({
    signal: {
      symbol: 'TESTUSDT',
      signalId: 'signal-1',
      interval: '15',
      direction: context.signalDirection ?? 'LONG',
      timestamp: 1_700_000_000_000,
      strategy: 'TrendFollow',
      prices: {
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
  }) as any;

describe('trendFollowAiAdapter', () => {
  it('approves clean structure breakouts', () => {
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
          distanceToStopPct: 4,
          currentPrice: 101,
        },
        {
          regime: {
            trend: { bias: 'bull' },
          },
          participation: {
            volume: { volumeRel20: 1.2 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          derivatives: {
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

  it('uses tuned strategy context instead of conflicting shared trend-follow context', () => {
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
          distanceToStopPct: 4,
          currentPrice: 101,
        },
        {
          regime: {
            trend: {
              trendFollow: { state: 'bear' },
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
});
