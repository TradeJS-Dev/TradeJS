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
            volume: {
              volumeRel20: 1.6,
              effortVsResult: 80,
            },
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
          participation: {
            volume: {
              volumeRel20: 1.6,
              effortVsResult: 80,
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

  it('rejects ordinary self-aligned retests without participation confirmation', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          zoneKind: 'swing_high_liquidity',
          zoneHeight: 8,
          hitCount: 5,
          hitVolume: 4_000,
          filterMode: 'count',
          filterMetric: 5,
          retestPenetrationPct: 40,
          reactionCloseDistancePct: 0.3,
          reactionBodyAligned: true,
        },
        {
          structure: {
            liquidityZones: { activeRetestDirection: 'SHORT' },
          },
          participation: {
            volume: {
              volumeRel20: 0.7,
              effortVsResult: 220,
            },
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
  });

  it('rejects long breakout retests until the long side is recalibrated', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
          zoneHeight: 8,
          hitCount: 2,
          hitVolume: 4_000,
          filterMode: 'count',
          filterMetric: 2,
          retestPenetrationPct: 20,
          reactionCloseDistancePct: 1.1,
          reactionBodyAligned: true,
        },
        {
          structure: {
            localRange: {
              breakoutState: 'below_low_level',
            },
          },
          participation: {
            volume: {
              volumeRel20: 2.1,
              effortVsResult: 180,
            },
          },
          relative: {
            execution: {
              venueSpreadZScore: 0.4,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('does not approve long retests from benchmark derivatives point count alone', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
          raw: {
            crossAsset: {
              btcCorrelation: 0.2,
            },
          },
          derivatives: {
            intervals: {
              '15m': {
                points: 100,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('approves calibrated transition-structure retests', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
            trend: {
              adaptiveChannel: {
                flipDown: false,
              },
            },
          },
          structure: {
            structureZones: {
              state: 'transition',
            },
          },
          gateFeatures: {
            scores: {
              structure: 17,
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
      quality: 4,
      approved: true,
    });
  });

  it('rejects transition-structure retests below the rounded structure boundary', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
            trend: {
              adaptiveChannel: {
                flipDown: false,
              },
            },
          },
          structure: {
            structureZones: {
              state: 'transition',
            },
          },
          gateFeatures: {
            scores: {
              structure: 16.99,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('blocks transition-structure retests during weak ETH reference OI', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
            trend: {
              adaptiveChannel: {
                flipDown: false,
              },
            },
          },
          structure: {
            structureZones: {
              state: 'transition',
            },
          },
          derivatives: {
            referenceContexts: {
              ETHUSDT: {
                intervals: {
                  '15m': {
                    oiChangePct4h: -0.8,
                  },
                },
              },
            },
          },
          gateFeatures: {
            scores: {
              structure: 17,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('approves the rounded SOL reference stress pocket', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
            levels: {
              lowTouchCount20: 3,
            },
          },
          derivatives: {
            referenceContexts: {
              SOLUSDT: {
                intervals: {
                  '15m': {
                    oiChangePct24h: -4.2,
                    fundingZScore: -1.2,
                  },
                },
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
      quality: 4,
      approved: true,
    });
  });

  it('rejects SOL reference stress candidates above the rounded thresholds', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
            levels: {
              lowTouchCount20: 3,
            },
          },
          derivatives: {
            referenceContexts: {
              SOLUSDT: {
                intervals: {
                  '15m': {
                    oiChangePct24h: -4.19,
                    fundingZScore: -1.19,
                  },
                },
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('keeps long quiet-derivatives candidates blocked when BTC correlation conflicts', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
          raw: {
            crossAsset: {
              btcCorrelation: -0.1,
            },
          },
          derivatives: {
            intervals: {
              '15m': {
                points: 100,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('keeps long quiet-derivatives candidates blocked when BTC correlation is missing', () => {
    const result = liquidityZonesAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'swing_low_liquidity',
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
          derivatives: {
            intervals: {
              '15m': {
                points: 100,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining(
        'long_liquidity_retest_requires_recalibration',
      ),
    });
  });

  it('rejects short continuation breakdown retests', () => {
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
          retestPenetrationPct: 20,
          reactionCloseDistancePct: 1.1,
          reactionBodyAligned: true,
        },
        {
          structure: {
            localRange: {
              breakoutState: 'below_low_level',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.6,
              effortVsResult: 80,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining('continuation_breakout_retest'),
    });
  });

  it('rejects overextended volume confirmations', () => {
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
          retestPenetrationPct: 20,
          reactionCloseDistancePct: 1.1,
          reactionBodyAligned: true,
        },
        {
          structure: {
            localRange: {
              breakoutState: 'inside_range',
            },
          },
          participation: {
            volume: {
              volumeRel20: 2.2,
              effortVsResult: 80,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining('overextended_volume_confirmation'),
    });
  });

  it('rejects retests with only one direct MA/MACD/OBV confirmation', () => {
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
          currentPrice: 100,
          retestPenetrationPct: 20,
          reactionCloseDistancePct: 1.1,
          reactionBodyAligned: true,
        },
        {
          raw: {
            trend: {
              maFast: 95,
              maMedium: 94,
              maSlow: 90,
            },
            momentum: {
              macd: 0.2,
              macdSignal: 0.1,
              macdHistogram: -0.1,
            },
            volume: {
              obv: 120,
              obvSma: 100,
            },
          },
          regime: {
            momentum: {
              macdHistogramSlope: 0.02,
            },
          },
          structure: {
            localRange: {
              breakoutState: 'inside_range',
            },
          },
          participation: {
            volume: {
              volumeRel20: 1.6,
              effortVsResult: 80,
              obvSlope: 10,
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
      quality: 3,
      approved: false,
      rejectReason: expect.stringContaining('isolated_indicator_support'),
    });
  });
});
