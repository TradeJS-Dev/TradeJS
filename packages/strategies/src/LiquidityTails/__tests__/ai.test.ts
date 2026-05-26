/** @jest-environment node */

import { liquidityTailsAiAdapter } from '../adapters/ai';

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
      strategy: 'LiquidityTails',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      liquidityTailsContext: context,
      baseContext,
    },
  }) as any;

describe('liquidityTailsAiAdapter', () => {
  it('approves clean liquidity-zone retests', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'buy_pressure',
          zoneHeight: 5,
          zoneTouches: 2,
          wickBodyRatio: 2.5,
          wickDominanceRatio: 2,
          retestPenetrationPct: 30,
          reactionCloseDistancePct: 0.12,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: { bias: 'bull' },
          },
          participation: {
            volume: { volumeRel20: 1.2 },
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

  it('rejects retests without a directional reaction body', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'SHORT',
        zoneKind: 'sell_pressure',
        zoneHeight: 5,
        wickBodyRatio: 2.5,
        wickDominanceRatio: 2,
        reactionCloseDistancePct: 0.12,
        reactionBodyAligned: false,
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
});
