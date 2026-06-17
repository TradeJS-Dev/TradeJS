import { buildAiTrainEvaluationFeatureSnapshot } from '../lib/aiTrainEvaluationDump';

describe('aiTrainEvaluationDump', () => {
  it('omits feature snapshots in none mode', () => {
    expect(
      buildAiTrainEvaluationFeatureSnapshot({
        additionalIndicators: {},
        mode: 'none',
      }),
    ).toBeUndefined();
  });

  it('captures current gate features without full base context by default', () => {
    const snapshot = buildAiTrainEvaluationFeatureSnapshot({
      mode: 'gateFeatures',
      additionalIndicators: {
        baseContext: {
          raw: { bulky: true },
          regime: { session: { sessionPhase: 'us' } },
          gateFeatures: {
            relative: {
              cmcExchangeLiquidityRegime: 'contracting',
              cmcExchangeLiquidityAligned: false,
            },
          },
          liquidityTailsGateFeatures: {
            retestAcceptance: 'strong',
          },
        },
      },
    });

    expect(snapshot).toEqual({
      baseContextAvailable: true,
      gateFeatures: {
        relative: {
          cmcExchangeLiquidityRegime: 'contracting',
          cmcExchangeLiquidityAligned: false,
        },
      },
      strategyGateFeatures: {
        liquidityTailsGateFeatures: {
          retestAcceptance: 'strong',
        },
      },
    });
  });

  it('captures compact base context feature sections when requested', () => {
    const snapshot = buildAiTrainEvaluationFeatureSnapshot({
      mode: 'baseContext',
      additionalIndicators: {
        baseContext: {
          raw: { bulky: true },
          regime: { trend: { bias: 'bear' } },
          structure: { localRange: { breakoutState: 'inside_range' } },
          participation: { volume: { volumeRel20: 1.2 } },
          relative: { cmcFearGreedRegime: 'risk_off' },
          derivatives: { summary: { pressure: 'short_flush' } },
          mtf: { summary: { mtfAlignment: 'bearish' } },
          gateFeatures: { volatility: { atrPctRankBucket: 'high' } },
        },
      },
    });

    expect(snapshot).toMatchObject({
      baseContextAvailable: true,
      gateFeatures: { volatility: { atrPctRankBucket: 'high' } },
      baseContext: {
        regime: { trend: { bias: 'bear' } },
        structure: { localRange: { breakoutState: 'inside_range' } },
        participation: { volume: { volumeRel20: 1.2 } },
        relative: { cmcFearGreedRegime: 'risk_off' },
        derivatives: { summary: { pressure: 'short_flush' } },
        mtf: { summary: { mtfAlignment: 'bearish' } },
        gateFeatures: { volatility: { atrPctRankBucket: 'high' } },
      },
    });
    expect(
      (snapshot as { baseContext?: Record<string, unknown> }).baseContext,
    ).not.toHaveProperty('raw');
  });

  it('marks missing base context explicitly', () => {
    expect(
      buildAiTrainEvaluationFeatureSnapshot({
        mode: 'gateFeatures',
        additionalIndicators: {},
      }),
    ).toEqual({
      baseContextAvailable: false,
    });
  });
});
