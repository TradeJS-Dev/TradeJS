/** @jest-environment node */

import { liquidityZonesAiAdapter } from '../adapters/ai';

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
      strategy: 'LiquidityZones',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      liquidityZonesContext: context,
      baseContext,
    },
  }) as any;

describe('liquidityZonesAiAdapter', () => {
  it('approves clean pivot-zone retests', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          zoneKind: 'swing_high_liquidity',
          zoneHeight: 8,
          hitCount: 3,
          hitVolume: 4_000,
          filterMode: 'count',
          filterMetric: 3,
          retestPenetrationPct: 55,
          reactionCloseDistancePct: 0.12,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: { bias: 'bear' },
          },
          participation: {
            volume: { volumeRel20: 1.2 },
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

  it('rejects retests without reaction body alignment', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'LONG',
        zoneKind: 'swing_low_liquidity',
        zoneHeight: 8,
        filterMetric: 2,
        retestPenetrationPct: 40,
        reactionCloseDistancePct: 0.1,
        reactionBodyAligned: false,
      }),
      analysis: {
        direction: 'LONG',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 1,
      approved: false,
    });
  });

  it('uses tuned strategy context instead of conflicting shared liquidity-zone context', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          zoneKind: 'swing_high_liquidity',
          zoneHeight: 8,
          hitCount: 3,
          hitVolume: 4_000,
          filterMode: 'count',
          filterMetric: 3,
          retestPenetrationPct: 55,
          reactionCloseDistancePct: 0.12,
          reactionBodyAligned: true,
        },
        {
          structure: {
            liquidityZones: { activeRetestDirection: 'LONG' },
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
