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
    },
    marketBreadth: {
      equalWeightedReturn: 0.02,
    },
  },
  participation: {
    volume: {
      volumeRel20: 1.3,
    },
  },
  regime: {
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
