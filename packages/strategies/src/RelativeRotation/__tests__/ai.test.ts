/** @jest-environment node */

import { relativeRotationAiAdapter } from '../adapters/ai';

const makePayload = ({
  signalContext = {},
  baseContext = {},
}: {
  signalContext?: Record<string, unknown>;
  baseContext?: Record<string, unknown>;
} = {}) =>
  ({
    signal: {
      symbol: 'TESTUSDT',
      signalId: 'signal-1',
      interval: '15',
      direction: signalContext.signalDirection ?? 'LONG',
      timestamp: 1_700_000_000_000,
      strategy: 'RelativeRotation',
      prices: {
        currentPrice: 100,
        takeProfitPrice: 103,
        stopLossPrice: 98,
      },
    },
    figures: {},
    indicators: {},
    additionalIndicators: {
      relativeRotationContext: signalContext,
      baseContext,
    },
  }) as any;

const makeCleanBaseContext = () => ({
  relative: {
    targetVsBtc: {
      ratioReturn1h: -4,
      alphaVsBtc1h: -3.8,
      alphaVsBtc24h: -4.5,
      ratioReturn24h: -4.2,
      ratioTrend: 'down',
    },
    targetVsEth: {
      alphaVsEth24h: 3.9,
      ratioReturn24h: 4.1,
      ratioTrend: 'down',
    },
    btcAltRegime: {
      regime: 'alt_lead',
      altBasketReturn1h: -0.02,
      btcVsAltReturn1h: -0.001,
      btcTurnoverShare24h: 0.25,
    },
    marketBreadth: {
      equalWeightedReturn: 0.02,
      dispersion: 0.005,
    },
    cmcFearGreed: {
      valueChange7d: -12,
      stale: false,
    },
  },
  raw: {
    price: {
      price1hPct: -5,
    },
  },
  participation: {
    volume: {
      volumeRel20: 1.3,
    },
  },
  regime: {
    session: {
      minutesToFundingWindow: 435,
    },
    trend: {
      bias: 'bear',
      adx: {
        diMinus: 50,
      },
    },
  },
  structure: {
    localRange: {
      distanceToLowLevelAtr: -2.75,
    },
  },
  gateFeatures: {
    conflicts: {
      count: 1,
      items: [],
    },
    scores: {
      totalContext: 68,
    },
  },
});

describe('relativeRotationAiAdapter', () => {
  it('hydrates canonical context and approves the validated SHORT boundary', () => {
    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: {
          signalDirection: 'SHORT',
          btcAltRegime: null,
          marketBreadthReturn: null,
          targetVsEthRatioTrend: null,
        },
        baseContext: makeCleanBaseContext(),
      }),
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

  it('approves SHORT just inside the post-funding cooldown boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.regime.session.minutesToFundingWindow = 434.99;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
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

  it('rejects SHORT just outside the post-funding cooldown boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.regime.session.minutesToFundingWindow = 435.01;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'post_funding_cooldown_active',
    });
  });

  it.each(['missing', 'null'] as const)(
    'hard-blocks a %s funding-window value',
    (value) => {
      const baseContext = makeCleanBaseContext();
      if (value === 'missing') {
        delete (baseContext.regime.session as any).minutesToFundingWindow;
      } else {
        baseContext.regime.session.minutesToFundingWindow = null as any;
      }

      const result = relativeRotationAiAdapter.postProcessAnalysis?.({
        signal: {} as any,
        payload: makePayload({
          signalContext: { signalDirection: 'SHORT' },
          baseContext,
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
        rejectReason: 'missing_minutes_to_funding_window',
      });
    },
  );

  it('rejects a SHORT signal inside the validated breakdown boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.structure.localRange.distanceToLowLevelAtr = -2.74;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'insufficient_breakdown_distance',
    });
  });

  it('rejects a SHORT signal above the validated DI- boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.regime.trend.adx.diMinus = 50.01;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'adx_di_minus_above_stable_range',
    });
  });

  it('rejects a SHORT signal above the validated 1h downside boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.raw.price.price1hPct = -4.99;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'insufficient_hourly_downside_impulse',
    });
  });

  it('rejects a SHORT signal below the validated Fear & Greed boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.relative.cmcFearGreed.valueChange7d = -12.01;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'fear_greed_7d_drop_below_stable_range',
    });
  });

  it('approves the validated breadth recovery boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.structure.localRange.distanceToLowLevelAtr = -2.74;
    baseContext.regime.trend.adx.diMinus = 50.01;
    baseContext.relative.marketBreadth.dispersion = 0.0085;
    baseContext.relative.btcAltRegime.altBasketReturn1h = -0.015;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
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
    expect((result as any)?.rejectReason).toBeUndefined();
  });

  it('rejects breadth recovery outside either rounded boundary', () => {
    const makeRecoveryBaseContext = () => {
      const baseContext = makeCleanBaseContext();
      baseContext.structure.localRange.distanceToLowLevelAtr = -2.74;
      baseContext.relative.marketBreadth.dispersion = 0.0085;
      baseContext.relative.btcAltRegime.altBasketReturn1h = -0.015;
      return baseContext;
    };
    const analyze = (baseContext: ReturnType<typeof makeCleanBaseContext>) =>
      relativeRotationAiAdapter.postProcessAnalysis?.({
        signal: {} as any,
        payload: makePayload({
          signalContext: { signalDirection: 'SHORT' },
          baseContext,
        }),
        analysis: {
          direction: 'SHORT',
          quality: 5,
        },
      });

    const lowDispersion = makeRecoveryBaseContext();
    lowDispersion.relative.marketBreadth.dispersion = 0.00849;
    expect(analyze(lowDispersion)).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
    });

    const weakAltReturn = makeRecoveryBaseContext();
    weakAltReturn.relative.btcAltRegime.altBasketReturn1h = -0.01501;
    expect(analyze(weakAltReturn)).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
    });
  });

  it('does not require recovery fields for the primary breakdown pocket', () => {
    const baseContext = makeCleanBaseContext();
    delete (baseContext as any).relative.marketBreadth.dispersion;
    delete (baseContext as any).relative.btcAltRegime.altBasketReturn1h;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
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

  it('rejects SHORT below the validated BTC-vs-alt 1h boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.relative.btcAltRegime.btcVsAltReturn1h = -0.00101;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'btc_vs_alt_return_1h_below_stable_range',
    });
  });

  it('rejects SHORT below the validated BTC turnover-share boundary', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.relative.btcAltRegime.btcTurnoverShare24h = 0.2499;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'btc_turnover_share_24h_below_stable_range',
    });
  });

  it('does not let the recovery pocket bypass BTC market leadership', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.structure.localRange.distanceToLowLevelAtr = -2.74;
    baseContext.regime.trend.adx.diMinus = 50.01;
    baseContext.relative.marketBreadth.dispersion = 0.0085;
    baseContext.relative.btcAltRegime.altBasketReturn1h = -0.015;
    baseContext.relative.btcAltRegime.btcVsAltReturn1h = -0.00101;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'btc_vs_alt_return_1h_below_stable_range',
    });
  });

  it('does not let the recovery pocket bypass the post-funding cooldown', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.structure.localRange.distanceToLowLevelAtr = -2.74;
    baseContext.regime.trend.adx.diMinus = 50.01;
    baseContext.relative.marketBreadth.dispersion = 0.0085;
    baseContext.relative.btcAltRegime.altBasketReturn1h = -0.015;
    baseContext.regime.session.minutesToFundingWindow = 450;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
      }),
      analysis: {
        direction: 'SHORT',
        quality: 5,
      },
    });

    expect(result).toMatchObject({
      direction: null,
      quality: 3,
      approved: false,
      rejectReason: 'post_funding_cooldown_active',
    });
  });

  it('hard-blocks missing or null BTC market leadership inputs', () => {
    const baseContext = makeCleanBaseContext();
    delete (baseContext as any).relative.btcAltRegime.btcVsAltReturn1h;
    baseContext.relative.btcAltRegime.btcTurnoverShare24h = null as any;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
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
    expect((result as any)?.rejectReason).toContain(
      'missing_btc_vs_alt_return_1h',
    );
    expect((result as any)?.rejectReason).toContain(
      'missing_btc_turnover_share_24h',
    );
  });

  it('hard-blocks stale Fear & Greed context', () => {
    const baseContext = makeCleanBaseContext();
    baseContext.relative.cmcFearGreed.stale = true;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
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
      rejectReason: 'stale_cmc_fear_greed_context',
    });
  });

  it('hard-blocks missing price and Fear & Greed gate inputs', () => {
    const baseContext = makeCleanBaseContext();
    delete (baseContext as any).raw.price.price1hPct;
    delete (baseContext as any).relative.cmcFearGreed;

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext,
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
    expect((result as any)?.rejectReason).toContain('missing_price_1h_pct');
    expect((result as any)?.rejectReason).toContain(
      'missing_cmc_fear_greed_change_7d',
    );
    expect((result as any)?.rejectReason).toContain(
      'missing_cmc_fear_greed_freshness',
    );
  });

  it('keeps LONG disabled by the validated gate', () => {
    const baseContext = makeCleanBaseContext();

    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'LONG' },
        baseContext,
      }),
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
    expect((result as any)?.rejectReason).toContain(
      'long_direction_not_validated',
    );
  });

  it('rejects missing target-vs-BTC causal context', () => {
    const result = relativeRotationAiAdapter.postProcessAnalysis?.({
      signal: {} as any,
      payload: makePayload({
        signalContext: { signalDirection: 'SHORT' },
        baseContext: {
          structure: {
            localRange: { distanceToLowLevelAtr: -3 },
          },
          regime: {
            trend: { adx: { diMinus: 40 } },
          },
          gateFeatures: {
            conflicts: { count: 0, items: [] },
          },
        },
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
    expect((result as any)?.rejectReason).toContain(
      'missing_target_vs_btc_context',
    );
  });
});
