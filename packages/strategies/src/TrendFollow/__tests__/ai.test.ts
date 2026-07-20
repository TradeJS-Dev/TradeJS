/** @jest-environment node */

import { trendFollowAiAdapter } from '../adapters/ai';

const supportiveBtcAltRegime = {
  btcTurnoverShare24h: 0.35,
  altBasketReturn24h: -0.01,
};

const makePayload = (
  context: Record<string, unknown>,
  baseContext: Record<string, unknown> = {},
) => {
  const direction = context.signalDirection === 'SHORT' ? 'SHORT' : 'LONG';
  const regime = (baseContext.regime ?? {}) as Record<string, unknown>;
  const volatility = (regime.volatility ?? {}) as Record<string, unknown>;
  const baseContextWithDefaults: Record<string, unknown> = {
    ...baseContext,
    regime: {
      ...regime,
      volatility: {
        state: 'normal',
        ...volatility,
      },
    },
  };
  const normalizedBaseContext =
    baseContextWithDefaults.gateFeatures === undefined
      ? {
          ...baseContextWithDefaults,
          gateFeatures: {
            scores: {
              participation: 86,
            },
          },
        }
      : baseContextWithDefaults;

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
      baseContext: normalizedBaseContext,
    },
  } as any;
};

const makeShortFlushPayload = ({
  oiChangePct24h = 2.1,
  liqLong = 13,
  liqImbalance = -0.8,
  btcTurnoverShare24h = 0.35,
  altBasketReturn24h = -0.01,
  targetVsBtcBeta20 = 1.35,
  participationScore = 86,
  volatilityState = 'normal',
}: {
  oiChangePct24h?: number;
  liqLong?: number;
  liqImbalance?: number;
  btcTurnoverShare24h?: number;
  altBasketReturn24h?: number;
  targetVsBtcBeta20?: number;
  participationScore?: number | null;
  volatilityState?: string;
} = {}) => {
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
      gateFeatures:
        participationScore == null
          ? { scores: {} }
          : {
              scores: {
                participation: participationScore,
              },
            },
      regime: {
        volatility: { state: volatilityState },
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
        intervals: {
          '1h': {
            oiChangePct24h,
            liqLong,
            liqImbalance,
          },
        },
      },
      relative: {
        targetVsBtc: {
          betaToBtc20: targetVsBtcBeta20,
        },
        btcAltRegime: {
          btcTurnoverShare24h,
          altBasketReturn24h,
        },
      },
    },
  );

  payload.signal.prices = {
    currentPrice: 100,
    takeProfitPrice: 97.4,
    stopLossPrice: 102,
  };

  return payload;
};

const makeReferencePocketPayload = ({
  minutesFromSessionOpen = 120,
  xrp15mOpenInterest = 273_000_000,
  xrp15mOiChangePct24h = 0,
  xrp1hOiChangePct1h = 0,
  sol15mOpenInterest = 10_300_000,
  sol15mOiChangePct4h = 0,
  sol15mFundingZScore = 0,
  bnb15mOpenInterest = 560_000,
  bnb15mOiChangePct24h = -2.7,
  trx15mFundingRate = 0,
  ethCrowdingPersistenceBars = 0,
}: {
  minutesFromSessionOpen?: number;
  xrp15mOpenInterest?: number;
  xrp15mOiChangePct24h?: number;
  xrp1hOiChangePct1h?: number;
  sol15mOpenInterest?: number;
  sol15mOiChangePct4h?: number;
  sol15mFundingZScore?: number;
  bnb15mOpenInterest?: number;
  bnb15mOiChangePct24h?: number;
  trx15mFundingRate?: number;
  ethCrowdingPersistenceBars?: number;
} = {}) =>
  makePayload(
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
        session: {
          minutesFromSessionOpen,
        },
        volatility: { state: 'normal' },
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
        intervals: {},
        referenceContexts: {
          XRPUSDT: {
            intervals: {
              '15m': {
                openInterest: xrp15mOpenInterest,
                oiChangePct24h: xrp15mOiChangePct24h,
              },
              '1h': {
                oiChangePct1h: xrp1hOiChangePct1h,
              },
            },
          },
          SOLUSDT: {
            intervals: {
              '15m': {
                openInterest: sol15mOpenInterest,
                oiChangePct4h: sol15mOiChangePct4h,
                fundingZScore: sol15mFundingZScore,
              },
            },
          },
          BNBUSDT: {
            intervals: {
              '15m': {
                openInterest: bnb15mOpenInterest,
                oiChangePct24h: bnb15mOiChangePct24h,
              },
            },
          },
          TRXUSDT: {
            intervals: {
              '15m': {
                fundingRate: trx15mFundingRate,
              },
            },
          },
          ETHUSDT: {
            intervals: {},
            summary: {
              crowdingPersistenceBars: ethCrowdingPersistenceBars,
            },
          },
        },
      },
    },
  );

describe('trendFollowAiAdapter', () => {
  it('keeps BTC short-flush breakouts in watch mode', () => {
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
            intervals: {
              '1h': {
                oiChangePct24h: 2.1,
                liqLong: 13,
                liqImbalance: -0.8,
              },
            },
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
          relative: {
            targetVsBtc: { betaToBtc20: 1.35 },
            btcAltRegime: supportiveBtcAltRegime,
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
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
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

  it('keeps short derivatives flush/OI cadence pockets in watch mode', () => {
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
        derivatives: {
          intervals: {
            '1h': {
              oiChangePct24h: 2.1,
              liqLong: 13,
              liqImbalance: -0.8,
            },
          },
          summary: {
            pressure: 'long_flush',
            riskFlags: ['long_liquidation_spike'],
          },
        },
        relative: {
          targetVsBtc: { betaToBtc20: 1.35 },
          btcAltRegime: supportiveBtcAltRegime,
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
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });

  it('rejects q4 soft-blocked derivatives flush/OI cadence pockets', () => {
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
          momentum: { rsi: 42 },
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
          intervals: {
            '1h': {
              oiChangePct24h: 2.1,
              liqLong: 13,
              liqImbalance: -0.8,
            },
          },
        },
        relative: {
          targetVsBtc: { betaToBtc20: 1.35 },
          btcAltRegime: supportiveBtcAltRegime,
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
      direction: null,
      quality: 4,
      approved: false,
    });
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });

  it('rejects long relative beta continuation pockets', () => {
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
      direction: null,
      quality: 4,
      approved: false,
    });
  });

  it('rejects relative beta compact-stop pockets without derivatives flush/OI support', () => {
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

  it('rejects short derivatives pockets with insufficient liquidation imbalance', () => {
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
        derivatives: {
          intervals: {
            '1h': {
              oiChangePct24h: 2.1,
              liqLong: 13,
              liqImbalance: -0.5,
            },
          },
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

  it('rejects short derivatives pockets when BTC turnover dominates', () => {
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
        derivatives: {
          intervals: {
            '1h': {
              oiChangePct24h: 2.1,
              liqLong: 13,
              liqImbalance: -0.8,
            },
          },
        },
        relative: {
          btcAltRegime: {
            btcTurnoverShare24h: 0.5,
            altBasketReturn24h: 0,
          },
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

  it('rejects the tuned short flush pocket at the liquidation threshold', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        liqLong: 12,
        liqImbalance: -0.75,
        btcTurnoverShare24h: 0.416873,
        altBasketReturn24h: 0.052358,
      }),
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
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });

  it('rejects short derivatives pockets outside normal volatility', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        volatilityState: 'expanded',
      }),
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

  it('approves the rounded reference OI compression pocket', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeReferencePocketPayload(),
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

  it('rejects reference OI compression when BTC short-flush is active', () => {
    const payload = makeReferencePocketPayload();
    (payload.additionalIndicators.baseContext as any).derivatives.intervals[
      '1h'
    ] = {
      oiChangePct24h: 2.1,
      liqLong: 13,
      liqImbalance: -0.8,
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

  it('rejects the reference OI compression pocket above the BNB OI-change cap', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeReferencePocketPayload({
        bnb15mOiChangePct24h: -2.69,
      }),
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

  it('keeps the rounded opening-session XRP/BNB reference pocket in watch mode', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeReferencePocketPayload({
        minutesFromSessionOpen: 75,
        xrp15mOpenInterest: 324_000_000,
        xrp1hOiChangePct1h: 0.4,
        bnb15mOpenInterest: 560_000,
        bnb15mOiChangePct24h: 0,
        sol15mOpenInterest: 0,
      }),
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
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });

  it('rejects the opening-session reference pocket below the XRP 1h OI-change floor', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeReferencePocketPayload({
        minutesFromSessionOpen: 75,
        xrp15mOpenInterest: 324_000_000,
        xrp1hOiChangePct1h: 0.399,
        bnb15mOpenInterest: 560_000,
        bnb15mOiChangePct24h: 0,
        sol15mOpenInterest: 0,
      }),
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
  });

  it('blocks guarded reference pockets in the crowded ETH/SOL loss regime', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeReferencePocketPayload({
        ethCrowdingPersistenceBars: 90,
        sol15mFundingZScore: -1.6,
      }),
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

  it('rejects the opening-session reference pocket outside the crowded ETH/SOL loss block', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeReferencePocketPayload({
        minutesFromSessionOpen: 75,
        xrp15mOpenInterest: 324_000_000,
        xrp1hOiChangePct1h: 0.4,
        bnb15mOpenInterest: 560_000,
        bnb15mOiChangePct24h: 0,
        ethCrowdingPersistenceBars: 90,
        sol15mOpenInterest: 0,
        sol15mFundingZScore: -1.6,
      }),
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
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });

  it('rejects short derivatives pockets above the shared participation score cap', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        participationScore: 87,
      }),
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

  it('rejects short derivatives pockets without the shared participation score', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        participationScore: null,
      }),
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

  it('rejects short derivatives pockets at the BTC turnover cap', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        btcTurnoverShare24h: 0.416874,
      }),
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

  it('rejects short derivatives pockets at the upper alt basket return cap', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        altBasketReturn24h: 0.052359,
      }),
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

  it('rejects short derivatives pockets at the target-vs-BTC beta floor', () => {
    const result = trendFollowAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makeShortFlushPayload({
        targetVsBtcBeta20: 0.627393,
      }),
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

  it('rejects short derivatives pockets when the alt basket is deeply red', () => {
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
        derivatives: {
          intervals: {
            '1h': {
              oiChangePct24h: 2.1,
              liqLong: 13,
              liqImbalance: -0.8,
            },
          },
        },
        relative: {
          btcAltRegime: {
            btcTurnoverShare24h: 0.35,
            altBasketReturn24h: -0.03,
          },
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

  it('keeps BTC short-flush watch mode independent of shared trend-follow context', () => {
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
            intervals: {
              '1h': {
                oiChangePct24h: 2.1,
                liqLong: 13,
                liqImbalance: -0.8,
              },
            },
            summary: {
              pressure: 'long_flush',
              directionAligned: true,
              riskFlags: ['long_liquidation_spike'],
            },
          },
          relative: {
            targetVsBtc: { betaToBtc20: 1.35 },
            btcAltRegime: supportiveBtcAltRegime,
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
    expect((result as any)?.rejectReason).toContain(
      'outside_high_conviction_cadence_pocket',
    );
  });
});
