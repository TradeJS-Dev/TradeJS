/** @jest-environment node */

import { liquidityTailsAiAdapter } from '../adapters/ai';

const withApprovalContextDefaults = (baseContext: Record<string, unknown>) => {
  const regime = (baseContext.regime ?? {}) as Record<string, unknown>;
  const trend = (regime.trend ?? {}) as Record<string, unknown>;
  const structure = (baseContext.structure ?? {}) as Record<string, unknown>;
  const liquidityZones = (structure.liquidityZones ?? {}) as Record<
    string,
    unknown
  >;

  return {
    ...baseContext,
    regime: {
      ...regime,
      trend: {
        priceDistanceToMaSlowAtr: 0,
        ...trend,
      },
    },
    structure: {
      ...structure,
      liquidityZones: {
        activeCount: 1,
        ...liquidityZones,
      },
    },
  };
};

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
      baseContext: withApprovalContextDefaults(baseContext),
    },
  }) as any;

const makeRiskOffRecoveryPayload = ({
  direction = 'LONG',
  altBasketReturn24h = -0.035,
  trxOiChangePct4h = -1.8,
  trxStale = false,
  includeTrx = true,
}: {
  direction?: 'LONG' | 'SHORT';
  altBasketReturn24h?: number;
  trxOiChangePct4h?: number;
  trxStale?: boolean;
  includeTrx?: boolean;
} = {}) =>
  makePayload(
    {
      signalDirection: direction,
      zoneKind: direction === 'LONG' ? 'buy_pressure' : 'sell_pressure',
      zoneHeight: 5,
      zoneTouches: 2,
      wickBodyRatio: 2.5,
      wickDominanceRatio: 2,
      retestPenetrationPct: 30,
      reactionCloseDistancePct: 1.2,
      reactionBodyAligned: true,
    },
    {
      regime: {
        trend: {
          bias: 'neutral',
          adx: { adx: 20, strength: 'developing' },
        },
        momentum: { bodyStrength: 0.4, roc1h: 0.1, roc4h: 0.1 },
      },
      participation: {
        volume: { volumeRel20: 1.1 },
      },
      relative: {
        btcAltRegime: { altBasketReturn24h },
        cmcFearGreed: { value: 39 },
      },
      derivatives: {
        summary: {
          pressure: 'neutral',
          directionAligned: true,
          riskFlags: [],
        },
        referenceContexts: includeTrx
          ? {
              TRXUSDT: {
                intervals: {
                  '1h': {
                    stale: trxStale,
                    oiChangePct4h: trxOiChangePct4h,
                  },
                },
              },
            }
          : {},
      },
    },
  );

describe('liquidityTailsAiAdapter', () => {
  it('copies LiquidityTails gate features into strategy and base contexts', () => {
    const result = liquidityTailsAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          liquidityTailsContext: {
            signalDirection: 'LONG',
            zoneKind: 'buy_pressure',
            zoneHeight: 5,
            zoneTouches: 2,
            wickBodyRatio: 2.5,
            wickDominanceRatio: 2,
            reactionCloseDistancePct: 2.1,
            reactionBodyAligned: true,
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: {
            regime: {
              trend: {
                bias: 'bear',
                adx: { adx: 35, strength: 'strong' },
              },
              momentum: { roc1h: 1.4, roc4h: 0.8 },
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
        },
      } as any,
    } as any);

    expect(
      (result as any).additionalIndicators.liquidityTailsContext
        .liquidityTailsGateFeatures,
    ).toMatchObject({
      zoneQuality: 'mature',
      retestAcceptance: 'strong',
      highQualityRetestPocket: true,
    });
    expect(
      (result as any).additionalIndicators.baseContext
        .liquidityTailsGateFeatures,
    ).toMatchObject({
      zoneQuality: 'mature',
      retestAcceptance: 'strong',
    });
  });

  it('approves strong close-away liquidity-zone retests', () => {
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
          reactionCloseDistancePct: 2.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
              priceDistanceToMaSlowAtr: 1.2,
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.2 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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

  it('rejects otherwise approved retests beyond the slow MA distance limit', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'buy_pressure',
          zoneHeight: 5,
          reactionCloseDistancePct: 2.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
              priceDistanceToMaSlowAtr: 1.200_001,
            },
            momentum: { bodyStrength: 0.4, roc4h: 0.8 },
          },
          relative: { cmcFearGreed: { value: 39 } },
        },
      ),
      analysis: { direction: 'LONG', quality: 5 },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('price_overextended_from_ma_slow');
  });

  it('rejects otherwise approved retests without slow MA distance data', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'buy_pressure',
          zoneHeight: 5,
          reactionCloseDistancePct: 2.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
              priceDistanceToMaSlowAtr: null,
            },
            momentum: { bodyStrength: 0.4, roc4h: 0.8 },
          },
          relative: { cmcFearGreed: { value: 39 } },
        },
      ),
      analysis: { direction: 'LONG', quality: 5 },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('price_distance_to_ma_slow_unavailable');
  });

  it('rejects otherwise approved retests without an active liquidity zone', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'buy_pressure',
          zoneHeight: 5,
          reactionCloseDistancePct: 2.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
              priceDistanceToMaSlowAtr: 1.2,
            },
            momentum: { bodyStrength: 0.4, roc4h: 0.8 },
          },
          structure: { liquidityZones: { activeCount: 0 } },
          relative: { cmcFearGreed: { value: 39 } },
        },
      ),
      analysis: { direction: 'LONG', quality: 5 },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('liquidity_zone_confirmation_missing');
  });

  it('rejects shallow wick-only retests without close-away impulse', () => {
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
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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
      quality: 3,
      approved: false,
    });
  });

  it('rejects medium close-away reactions below the approval threshold', () => {
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
          reactionCloseDistancePct: 1.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
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
      quality: 3,
      approved: false,
    });
  });

  it('requires stronger close-away reaction for US long retests', () => {
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
          reactionCloseDistancePct: 2.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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
      quality: 3,
      approved: false,
    });
  });

  it('approves US long retests after stronger close-away reaction', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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

  it('rejects q4 retests when the reaction body is below the approval floor', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.39, roc1h: 1.4, roc4h: 0.8 },
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
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('insufficient_reaction_body_strength');
  });

  it('approves q4 retests at the reaction body approval floor', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.4, roc1h: 1.4, roc4h: 0.8 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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

  it('upgrades conservative q3 retests when MTF and benchmark context are clean', () => {
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
          reactionCloseDistancePct: 1.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
          },
          gateFeatures: {
            volatility: { atrPctRankBucket: 'high' },
            mtf: { higherTimeframeConflict: false },
            relative: { benchmarkConflict: false },
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

  it('keeps q4 retests below approval when ATR rank is not high or extreme', () => {
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
          reactionCloseDistancePct: 1.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          gateFeatures: {
            volatility: { atrPctRankBucket: 'normal' },
            mtf: { higherTimeframeConflict: false },
            relative: { benchmarkConflict: false },
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
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('q4_atr_rank_not_high');
  });

  it('keeps otherwise approved retests below approval when liquidity risk is high', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          gateFeatures: {
            risk: { liquidityRisk: 'high' },
            volatility: { atrPctRankBucket: 'high' },
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
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('high_liquidity_risk');
  });

  it('approves otherwise eligible retests at the CMC fear and greed approval cap', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
          },
          gateFeatures: {
            risk: { liquidityRisk: 'low' },
            volatility: { atrPctRankBucket: 'high' },
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

  it('keeps otherwise approved retests below approval when CMC fear and greed is above the cap', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          relative: {
            cmcFearGreed: { value: 40 },
          },
          gateFeatures: {
            risk: { liquidityRisk: 'low' },
            volatility: { atrPctRankBucket: 'high' },
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
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('cmc_fear_greed_above_approval_max');
  });

  it('keeps otherwise approved retests below approval when CMC fear and greed is unavailable', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            session: { sessionPhase: 'us' },
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          gateFeatures: {
            risk: { liquidityRisk: 'low' },
            volatility: { atrPctRankBucket: 'high' },
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
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('cmc_fear_greed_unavailable');
  });

  it('upgrades risk-off long retests at the rounded derivatives boundaries', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeRiskOffRecoveryPayload(),
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

  it('does not upgrade risk-off long retests above the alt-return boundary', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeRiskOffRecoveryPayload({ altBasketReturn24h: -0.0349 }),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 1,
      approved: false,
    });
  });

  it('does not upgrade risk-off long retests above the TRX OI boundary', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeRiskOffRecoveryPayload({ trxOiChangePct4h: -1.79 }),
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 1,
      approved: false,
    });
  });

  it.each([
    ['stale', { trxStale: true }],
    ['missing', { includeTrx: false }],
  ])(
    'does not upgrade risk-off long retests with %s TRX context',
    (_, options) => {
      const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
        signal: {} as any,
        payload: makeRiskOffRecoveryPayload(options),
        analysis: {
          direction: 'LONG',
          quality: 1,
        },
      });

      expect(result).toMatchObject({
        direction: null,
        quality: 1,
        approved: false,
      });
    },
  );

  it('does not upgrade short retests in the risk-off long recovery pocket', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeRiskOffRecoveryPayload({ direction: 'SHORT' }),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 1,
      approved: false,
    });
  });

  it('does not upgrade q3 retests with higher-timeframe conflict', () => {
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
          reactionCloseDistancePct: 1.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { bodyStrength: 0.65, roc1h: 1.4, roc4h: 0.8 },
          },
          participation: {
            volume: { volumeRel20: 1.1 },
          },
          gateFeatures: {
            mtf: { higherTimeframeConflict: true },
            relative: { benchmarkConflict: false },
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
      quality: 3,
      approved: false,
    });
  });

  it('blocks aligned derivatives reversals without flush support', () => {
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
          reactionCloseDistancePct: 2.6,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
          },
          derivatives: {
            summary: {
              pressure: 'neutral',
              directionAligned: true,
              riskFlags: [],
            },
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
      quality: 1,
      approved: false,
      rejectReason: 'derivatives_reversal_aligned',
    });
  });

  it('blocks conflicting derivatives reversals without flush support', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          zoneKind: 'sell_pressure',
          zoneHeight: 5,
          zoneTouches: 2,
          wickBodyRatio: 2.5,
          wickDominanceRatio: 2,
          retestPenetrationPct: 30,
          reactionCloseDistancePct: 3.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'neutral',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: -1.4, roc4h: 0.8 },
          },
          derivatives: {
            summary: {
              pressure: 'neutral',
              directionAligned: false,
              riskFlags: [],
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
      quality: 1,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('derivatives_reversal_conflict');
  });

  it('requires stronger close-away reaction for short retests', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          zoneKind: 'sell_pressure',
          zoneHeight: 5,
          zoneTouches: 2,
          wickBodyRatio: 2.5,
          wickDominanceRatio: 2,
          retestPenetrationPct: 30,
          reactionCloseDistancePct: 2.5,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'neutral',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: -1.4, roc4h: 0.8 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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

  it('approves high-conviction short retests after stronger close-away reaction', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'SHORT',
          zoneKind: 'sell_pressure',
          zoneHeight: 5,
          zoneTouches: 2,
          wickBodyRatio: 2.5,
          wickDominanceRatio: 2,
          retestPenetrationPct: 30,
          reactionCloseDistancePct: 3.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'neutral',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: -1.4, roc4h: 0.8 },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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

  it('uses tuned strategy context instead of conflicting shared liquidity-tail context', () => {
    const result = liquidityTailsAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload(
        {
          signalDirection: 'LONG',
          zoneKind: 'buy_pressure',
          zoneHeight: 5,
          zoneTouches: 0,
          wickBodyRatio: 2.5,
          wickDominanceRatio: 2,
          retestPenetrationPct: 30,
          reactionCloseDistancePct: 2.1,
          reactionBodyAligned: true,
        },
        {
          regime: {
            trend: {
              bias: 'bear',
              adx: { adx: 35, strength: 'strong' },
            },
            momentum: { roc1h: 1.4, roc4h: 0.8 },
          },
          structure: {
            liquidityTails: { activeRetestDirection: 'SHORT' },
          },
          relative: {
            cmcFearGreed: { value: 39 },
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
