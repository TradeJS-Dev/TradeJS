import type { AiPayload, Signal } from '@tradejs/types';
import {
  applyAiGateRebuildPolicy,
  getAiGateRebuildPolicy,
} from '../aiGateRebuild';

const makeSignal = (direction: 'LONG' | 'SHORT' = 'LONG') =>
  ({
    direction,
    prices: {
      takeProfitPrice: 110,
      stopLossPrice: 95,
    },
  }) as Signal;

const makePayload = (values: Record<string, unknown>): AiPayload => {
  const payload: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(values)) {
    const parts = path.split('.');
    let cursor = payload;
    for (const part of parts.slice(0, -1)) {
      const next = cursor[part];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts.at(-1)!] = value;
  }

  return payload as unknown as AiPayload;
};

const evaluate = (
  strategyName: string,
  payload: AiPayload,
  direction: 'LONG' | 'SHORT' = 'LONG',
) =>
  applyAiGateRebuildPolicy(strategyName).postProcessLocalAnalysis?.({
    signal: makeSignal(direction),
    payload,
    analysis: { direction, quality: 5 },
  }) as Record<string, unknown>;

describe('AI gate rebuild policies', () => {
  it.each([
    {
      strategy: 'AdaptiveMomentumRibbon',
      direction: 'LONG' as const,
      pass: {
        'additionalIndicators.baseContext.relative.marketBreadths.top100.unchanged': 10,
        'additionalIndicators.baseContext.participation.volumeStructure.pointOfControlVolumeShare': 0.166,
      },
      fail: {
        'additionalIndicators.baseContext.relative.marketBreadths.top100.unchanged': 9,
        'additionalIndicators.baseContext.participation.volumeStructure.pointOfControlVolumeShare': 0.166,
      },
    },
    {
      strategy: 'DoubleTap',
      direction: 'LONG' as const,
      pass: {
        'additionalIndicators.doubleTapContext.altDispersion24h': 0.032,
        'additionalIndicators.baseContext.regime.momentum.roc1h': 0,
      },
      fail: {
        'additionalIndicators.doubleTapContext.altDispersion24h': 0.03199,
        'additionalIndicators.baseContext.regime.momentum.roc1h': 0,
      },
    },
    {
      strategy: 'RelativeRotation',
      direction: 'SHORT' as const,
      pass: {
        'additionalIndicators.baseContext.regime.trend.adaptiveChannel.centerlineSlope':
          -0.0002,
        'additionalIndicators.baseContext.derivatives.referenceContexts.TRXUSDT.intervals.1h.liqImbalance': 0.17,
      },
      fail: {
        'additionalIndicators.baseContext.regime.trend.adaptiveChannel.centerlineSlope':
          -0.00019,
        'additionalIndicators.baseContext.derivatives.referenceContexts.TRXUSDT.intervals.1h.liqImbalance': 0.17,
      },
    },
    {
      strategy: 'StructureZones',
      direction: 'LONG' as const,
      pass: {
        'additionalIndicators.baseContext.mtf.summary.mtfAlignment':
          'aligned_bull',
        'additionalIndicators.baseContext.relative.marketBreadths.top50.decliners': 1,
      },
      fail: {
        'additionalIndicators.baseContext.mtf.summary.mtfAlignment':
          'aligned_bull',
        'additionalIndicators.baseContext.relative.marketBreadths.top50.decliners': 0,
      },
    },
  ])(
    '$strategy approves the boundary and rejects just outside it',
    (testCase) => {
      expect(
        evaluate(
          testCase.strategy,
          makePayload(testCase.pass),
          testCase.direction,
        ),
      ).toEqual(
        expect.objectContaining({
          direction: testCase.direction,
          quality: 4,
          approved: true,
          gateDecision: 'approved',
        }),
      );
      expect(
        evaluate(
          testCase.strategy,
          makePayload(testCase.fail),
          testCase.direction,
        ),
      ).toEqual(
        expect.objectContaining({
          direction: null,
          quality: 3,
          approved: false,
          gateDecision: 'rejected',
        }),
      );
    },
  );

  it('rejects a rebuilt rule when a required feature is missing', () => {
    expect(evaluate('DoubleTap', makePayload({}))).toEqual(
      expect.objectContaining({
        direction: null,
        approved: false,
      }),
    );
  });

  it('uses pass-through only for positive raw streams without a stable gate', () => {
    for (const strategy of ['Grid', 'TrendFollow', 'TrendLine']) {
      expect(evaluate(strategy, makePayload({}))).toEqual(
        expect.objectContaining({
          direction: 'LONG',
          quality: 4,
          approved: true,
          gateDecision: 'approved',
        }),
      );
    }
  });

  it('keeps legacy gates when the rebuild did not prove an improvement', () => {
    expect(getAiGateRebuildPolicy('AdaptiveTrendChannel')).toEqual({
      mode: 'legacy',
    });
    expect(getAiGateRebuildPolicy('TrendShift')).toEqual({
      mode: 'legacy',
    });
    expect(getAiGateRebuildPolicy('CupAndHandle')).toEqual({
      mode: 'legacy',
    });
    expect(getAiGateRebuildPolicy('HeadAndShoulders')).toEqual({
      mode: 'legacy',
    });
    expect(getAiGateRebuildPolicy('MarketFlushReversal')).toEqual({
      mode: 'legacy',
    });
  });

  it('blocks legacy gates that lose money on the new export', () => {
    expect(getAiGateRebuildPolicy('LiquidityZones')).toEqual({
      mode: 'observation',
    });
    expect(getAiGateRebuildPolicy('VolatilityCompressionBreakout')).toEqual({
      mode: 'observation',
    });
    expect(evaluate('LiquidityZones', makePayload({}))).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
      }),
    );
  });
});
