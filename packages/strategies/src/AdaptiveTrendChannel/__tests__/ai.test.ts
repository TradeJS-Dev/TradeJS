/** @jest-environment node */

import { adaptiveTrendChannelAiAdapter } from '../adapters/ai';

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
      strategy: 'AdaptiveTrendChannel',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 104,
        stopLossPrice: 98,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      adaptiveTrendChannelContext: context,
      baseContext,
    },
  }) as any;

describe('adaptiveTrendChannelAiAdapter', () => {
  it('approves clean adaptive channel flips', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          regime: 1,
          centerline: 100,
          roof: 103,
          floor: 97,
          halfChannel: 3,
          atr: 3,
          breakoutDistancePct: 4.2,
          channelWidthPct: 6,
          currentPrice: 104.2,
        },
        {
          regime: {
            trend: { bias: 'bull' },
          },
          participation: {
            volume: { volumeRel20: 7 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
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

  it('approves clean short flips above side-specific thresholds', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          regime: -1,
          centerline: 100,
          roof: 103,
          floor: 97,
          halfChannel: 3,
          atr: 3,
          breakoutDistancePct: 4.2,
          channelWidthPct: 6,
          currentPrice: 95.8,
        },
        {
          participation: {
            volume: { volumeRel20: 7 },
          },
          structure: {
            localRange: { breakoutState: 'below_low_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
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

  it('rejects short flips below side-specific thresholds', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          regime: -1,
          centerline: 100,
          roof: 103,
          floor: 97,
          halfChannel: 3,
          atr: 3,
          breakoutDistancePct: 4.1,
          channelWidthPct: 6,
          currentPrice: 95.9,
        },
        {
          participation: {
            volume: { volumeRel20: 6.8 },
          },
          structure: {
            localRange: { breakoutState: 'below_low_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
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
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('weak_breakout_distance');
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('weak_participation');
  });

  it('rejects flips without expanded h4 volatility', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          regime: -1,
          centerline: 100,
          roof: 103,
          floor: 97,
          halfChannel: 3,
          atr: 3,
          breakoutDistancePct: 4.2,
          channelWidthPct: 6,
          currentPrice: 95.8,
        },
        {
          participation: {
            volume: { volumeRel20: 7 },
          },
          structure: {
            localRange: { breakoutState: 'below_low_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'compressed' },
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
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('h4_volatility_not_expanded');
  });

  it('rejects flips without channel width', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalDirection: 'SHORT',
        regime: -1,
        centerline: 100,
        roof: 100,
        floor: 100,
        halfChannel: 0,
        atr: 0,
        breakoutDistancePct: 0.4,
        channelWidthPct: 0,
        currentPrice: 99.6,
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

  it('rejects weak breakouts even when shared adaptive channel context conflicts', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          regime: 1,
          centerline: 100,
          roof: 103,
          floor: 97,
          halfChannel: 3,
          atr: 3,
          breakoutDistancePct: 0.2,
          channelWidthPct: 6,
          currentPrice: 100.2,
        },
        {
          regime: {
            trend: {
              adaptiveChannel: { regime: 'bear' },
            },
          },
          participation: {
            volume: { volumeRel20: 7 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
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
      quality: 3,
      approved: false,
    });
  });

  it('uses tuned strategy context for approved high-conviction flips', () => {
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          regime: 1,
          centerline: 100,
          roof: 103,
          floor: 97,
          halfChannel: 3,
          atr: 3,
          breakoutDistancePct: 4.2,
          channelWidthPct: 6,
          currentPrice: 104.2,
        },
        {
          regime: {
            trend: {
              adaptiveChannel: { regime: 'bear' },
            },
          },
          participation: {
            volume: { volumeRel20: 7 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
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
