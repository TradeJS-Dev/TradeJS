/** @jest-environment node */

import { structureZonesAiAdapter } from '../adapters/ai';

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
      strategy: 'StructureZones',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      structureZonesContext: context,
      baseContext,
    },
  }) as any;

describe('structureZonesAiAdapter', () => {
  it('approves clean structure-zone reactions', () => {
    const result = structureZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          signalKind: 'support_reaction',
          marketState: 'Trend',
          structureBias: 'up',
          zoneKind: 'support',
          zoneHeight: 2,
          reactionCloseDistancePct: 0.15,
          reactionBodyAligned: true,
          currentPrice: 100,
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

  it('rejects reactions without aligned body', () => {
    const result = structureZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'SHORT',
        signalKind: 'resistance_reaction',
        marketState: 'Range',
        structureBias: 'range',
        zoneKind: 'resistance',
        zoneHeight: 2,
        reactionCloseDistancePct: 0.15,
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
