/** @jest-environment node */

import { buildStrategySignal } from '@tradejs/core/strategies';
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

const makeCleanLongBaseContext = ({
  approveBias = 'neutral',
  xrpOpenInterest15m,
}: {
  approveBias?: 'support' | 'neutral' | 'reject';
  xrpOpenInterest15m?: number | null;
} = {}) => ({
  regime: {
    trend: { bias: 'bull', trendFollow: { state: 'bull' } },
    momentum: { rsi: 72 },
    volatility: { percentiles: { bbWidthRank100: 80 } },
  },
  participation: {
    volume: { volumeRel20: 10 },
  },
  structure: {
    localRange: { breakoutState: 'above_high_level' },
  },
  mtf: {
    summary: { h4VolatilityState: 'expanded' },
  },
  derivatives:
    xrpOpenInterest15m === undefined
      ? {}
      : {
          referenceContexts: {
            XRPUSDT: {
              intervals: {
                '15m': {
                  openInterest: xrpOpenInterest15m,
                },
              },
            },
          },
        },
  gateFeatures: {
    decisionHints: {
      approveBias,
      maxReasonableQuality: approveBias === 'reject' ? 2 : 5,
      needsExtraConfirmation: approveBias === 'reject',
      primaryIssue: approveBias === 'reject' ? 'mtf_conflict' : 'none',
    },
    relative: {
      cmcExchangeLiquidityAligned: true,
      cmcExchangeLiquidityStale: false,
    },
  },
});

const makeXrpShortRecoveryBaseContext = ({
  approveBias = 'reject',
  xrpOpenInterest15m = 300_000_000,
  xrpPriceOiDivergenceType = 'price_down_oi_up',
  xrpFundingZScore1h = -1.8,
  btcVsAltReturn24h = -0.03,
  xrpDerivatives1hStale = false,
}: {
  approveBias?: 'support' | 'neutral' | 'reject';
  xrpOpenInterest15m?: number | null;
  xrpPriceOiDivergenceType?: string | null;
  xrpFundingZScore1h?: number | null;
  btcVsAltReturn24h?: number | null;
  xrpDerivatives1hStale?: boolean;
} = {}) => ({
  derivatives: {
    referenceContexts: {
      XRPUSDT: {
        summary: {
          priceOiDivergenceType: xrpPriceOiDivergenceType,
        },
        intervals: {
          '15m': {
            openInterest: xrpOpenInterest15m,
          },
          '1h': {
            fundingZScore: xrpFundingZScore1h,
            stale: xrpDerivatives1hStale,
          },
        },
      },
    },
  },
  gateFeatures: {
    decisionHints: {
      approveBias,
      maxReasonableQuality: approveBias === 'reject' ? 2 : 5,
      needsExtraConfirmation: approveBias === 'reject',
      primaryIssue: approveBias === 'reject' ? 'mtf_conflict' : 'none',
    },
    relative: {
      btcVsAltReturn24h,
      cmcExchangeLiquidityAligned: false,
      cmcExchangeLiquidityStale: false,
    },
  },
});

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
            trend: { bias: 'bull', trendFollow: { state: 'bull' } },
            momentum: { rsi: 72 },
            volatility: { percentiles: { bbWidthRank100: 80 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
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
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
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

  it('blocks clean flips when XRP open interest is high and base approve bias rejects', () => {
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
        makeCleanLongBaseContext({
          approveBias: 'reject',
          xrpOpenInterest15m: 250_000_000,
        }),
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
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('xrp_oi_reject_bias');
  });

  it('allows the rounded XRP reference short recovery pocket through high-XRP reject bias', () => {
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
          breakoutDistancePct: 0.5,
          channelWidthPct: 6,
          currentPrice: 99.5,
        },
        makeXrpShortRecoveryBaseContext(),
      ),
      analysis: {
        direction: 'SHORT',
        quality: 1,
      },
    });

    expect(result).toMatchObject({
      direction: 'SHORT',
      quality: 4,
      approved: true,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toBeUndefined();
  });

  it.each([
    ['BTC-vs-alt weakness is too shallow', { btcVsAltReturn24h: -0.029 }],
    ['XRP funding z-score is too shallow', { xrpFundingZScore1h: -1.79 }],
    [
      'XRP price/OI divergence is missing',
      { xrpPriceOiDivergenceType: 'unknown' },
    ],
    ['XRP 1h derivatives are stale', { xrpDerivatives1hStale: true }],
  ])(
    'keeps high-XRP reject bias blocked when the short recovery pocket misses: %s',
    (_label, overrides) => {
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
            breakoutDistancePct: 0.5,
            channelWidthPct: 6,
            currentPrice: 99.5,
          },
          makeXrpShortRecoveryBaseContext(overrides),
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
      ).toContain('xrp_oi_reject_bias');
    },
  );

  it.each([
    ['below the XRP OI threshold', 249_999_999],
    ['with missing XRP OI', undefined],
    ['with null XRP OI', null],
  ])(
    'keeps clean reject-bias flips approvable %s',
    (_label, xrpOpenInterest15m) => {
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
          makeCleanLongBaseContext({
            approveBias: 'reject',
            xrpOpenInterest15m,
          }),
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
    },
  );

  it('keeps gate approval stable without reading lazy indicator snapshot fields', () => {
    let lazyReads = 0;
    const approvingBaseContext = {
      regime: {
        trend: { bias: 'bull', trendFollow: { state: 'bull' } },
        momentum: { rsi: 72 },
        volatility: { percentiles: { bbWidthRank100: 80 } },
      },
      participation: {
        volume: { volumeRel20: 10 },
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
      relative: {
        cmcExchangeLiquidity: {
          liquidityRegime: 'expanding',
          stale: false,
        },
      },
    };
    const indicators = new Proxy(
      {
        baseContext: approvingBaseContext,
        maFast: [98, 99, 100],
      },
      {
        ownKeys(target) {
          return [...Reflect.ownKeys(target), 'maFast1h'];
        },
        getOwnPropertyDescriptor(target, prop) {
          if (prop === 'maFast1h') {
            return {
              enumerable: true,
              configurable: true,
            };
          }

          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
        get(target, prop, receiver) {
          if (prop === 'maFast1h') {
            lazyReads += 1;
            return [1, 2, 3];
          }

          return Reflect.get(target, prop, receiver);
        },
      },
    ) as any;
    const signal = buildStrategySignal({
      signalId: 'signal-2',
      strategy: 'AdaptiveTrendChannel',
      symbol: 'TESTUSDT',
      interval: '15' as any,
      direction: 'LONG',
      timestamp: 1_700_000_000_000,
      prices: {
        currentPrice: 104.2,
        takeProfitPrice: 110,
        stopLossPrice: 98,
        riskRatio: 2,
      },
      indicators,
      additionalIndicators: {
        adaptiveTrendChannelContext: {
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
      },
    });
    const result = adaptiveTrendChannelAiAdapter.postProcessAnalysis?.({
      signal,
      payload: {
        signal: {
          symbol: signal.symbol,
          signalId: signal.signalId,
          interval: signal.interval,
          direction: signal.direction,
          timestamp: signal.timestamp,
          strategy: signal.strategy,
          prices: signal.prices,
        },
        figures: signal.figures,
        indicators: signal.indicators,
        additionalIndicators: signal.additionalIndicators,
      } as any,
      analysis: {
        direction: 'LONG',
        quality: 1,
      },
    });

    expect(lazyReads).toBe(0);
    expect(signal.indicators).toEqual({
      maFast: [98, 99, 100],
    });
    expect(result).toMatchObject({
      direction: 'LONG',
      quality: 5,
      approved: true,
    });
  });

  it('keeps clean short flips in watch mode while short side is disabled', () => {
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
      direction: null,
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('short_side_disabled');
  });

  it('approves short liquidation recovery from canonical target derivative intervals', () => {
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
          breakoutDistancePct: 2,
          channelWidthPct: 1.4,
          currentPrice: 98,
        },
        {
          participation: {
            volume: { volumeRel20: 4.7 },
          },
          structure: {
            localRange: { breakoutState: 'inside_range' },
          },
          mtf: {
            summary: { h4VolatilityState: 'compressed' },
          },
          derivatives: {
            intervals: {
              '1h': {
                liqImbalance: -0.98,
                liqSpikeRatio: 5.8,
              },
            },
            referenceContexts: {
              ETHUSDT: {
                intervals: {
                  '1h': {
                    fundingRate: 0.003,
                  },
                },
              },
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
      quality: 4,
      approved: true,
    });
  });

  it('rejects short liquidation recovery when ETH funding is missing', () => {
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
          breakoutDistancePct: 2,
          channelWidthPct: 1.4,
          currentPrice: 98,
        },
        {
          participation: {
            volume: { volumeRel20: 4.7 },
          },
          derivatives: {
            intervals: {
              '1h': {
                liqImbalance: -0.98,
                liqSpikeRatio: 5.8,
              },
            },
            referenceContexts: {
              ETHUSDT: {
                intervals: {
                  '1h': {
                    fundingRate: null,
                  },
                },
              },
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
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('short_side_disabled');
  });

  it('includes canonical derivative interval fields in the human prompt addon', () => {
    const prompt = adaptiveTrendChannelAiAdapter.buildHumanPromptAddon?.({
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
            trend: { bias: 'bull', trendFollow: { state: 'bull' } },
            momentum: { rsi: 72 },
            volatility: { percentiles: { bbWidthRank100: 80 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
          },
          derivatives: {
            intervals: {
              '1h': {
                liqImbalance: -0.97,
                liqSpikeRatio: 5.8,
                liqTotal: 32,
              },
            },
            summary: {
              pressure: 'short_flush',
              directionAligned: true,
              riskFlags: ['short_liquidation_spike'],
            },
            referenceContexts: {
              ETHUSDT: {
                intervals: {
                  '1h': {
                    fundingRate: 0.003,
                  },
                },
              },
              XRPUSDT: {
                summary: {
                  priceOiDivergenceType: 'price_down_oi_up',
                },
                intervals: {
                  '15m': {
                    openInterest: 300_000_000,
                  },
                  '1h': {
                    fundingZScore: -1.8,
                  },
                },
              },
            },
          },
          gateFeatures: {
            relative: {
              btcVsAltReturn24h: -0.03,
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
            },
          },
        },
      ),
    });

    expect(prompt).toContain('targetLiqImbalance1h=-0.97');
    expect(prompt).toContain('targetLiqSpikeRatio1h=5.8');
    expect(prompt).toContain('targetLiqTotal1h=32');
    expect(prompt).toContain('ethFundingRate1h=0.003');
    expect(prompt).toContain('xrpOpenInterest15m=300000000');
    expect(prompt).toContain('xrpPriceOiDivergenceType=price_down_oi_up');
    expect(prompt).toContain('xrpFundingZScore1h=-1.8');
    expect(prompt).toContain('btcVsAltReturn24h=-0.03');
    expect(prompt).not.toContain('derivativesPressure');
    expect(prompt).not.toContain('derivativesDirectionAligned');
    expect(prompt).not.toContain('derivativesRiskFlags');
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
              trendFollow: { state: 'bull' },
            },
            momentum: { rsi: 72 },
            volatility: { percentiles: { bbWidthRank100: 80 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
          },
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
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
              trendFollow: { state: 'bull' },
            },
            momentum: { rsi: 72 },
            volatility: { percentiles: { bbWidthRank100: 80 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
          },
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
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

  it('rejects otherwise clean long flips with overheated rsi', () => {
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
            trend: { bias: 'bull', trendFollow: { state: 'bull' } },
            momentum: { rsi: 78 },
            volatility: { percentiles: { bbWidthRank100: 80 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
          },
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
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
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('overheated_rsi');
  });

  it('rejects otherwise clean long flips without enough volatility expansion rank', () => {
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
            trend: { bias: 'bull', trendFollow: { state: 'bull' } },
            momentum: { rsi: 72 },
            volatility: { percentiles: { bbWidthRank100: 40 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
          },
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
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
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('low_bb_width_rank');
  });

  it('rejects otherwise clean long flips outside a bullish trend-follow state', () => {
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
            trend: { bias: 'bull', trendFollow: { state: 'sideways' } },
            momentum: { rsi: 72 },
            volatility: { percentiles: { bbWidthRank100: 80 } },
          },
          participation: {
            volume: { volumeRel20: 10 },
          },
          structure: {
            localRange: { breakoutState: 'above_high_level' },
          },
          mtf: {
            summary: { h4VolatilityState: 'expanded' },
          },
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityAligned: true,
              cmcExchangeLiquidityStale: false,
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
      quality: 3,
      approved: false,
    });
    expect(
      (result as { rejectReason?: string } | undefined)?.rejectReason,
    ).toContain('trend_follow_not_bull');
  });
});
