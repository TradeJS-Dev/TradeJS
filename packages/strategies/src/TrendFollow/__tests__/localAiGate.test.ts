import type { AiPayload, Direction, Signal } from '@tradejs/types';
import { trendFollowAiAdapter } from '../adapters/ai';

const evaluate = ({
  direction = 'SHORT',
  advancers = 2,
  top5Unchanged = 0,
}: {
  direction?: Direction;
  advancers?: number;
  top5Unchanged?: number;
} = {}) =>
  trendFollowAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction,
      prices: { takeProfitPrice: 90, stopLossPrice: 105 },
    } as Signal,
    payload: {
      additionalIndicators: {
        baseContext: {
          relative: {
            marketBreadth: { advancers },
            marketBreadths: { top5: { unchanged: top5Unchanged } },
          },
        },
      },
    } as unknown as AiPayload,
    analysis: { direction, quality: 5 },
  });

describe('TrendFollow local AI gate', () => {
  it('approves the calibrated SHORT breadth boundary', () => {
    expect(evaluate()).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it.each([
    ['LONG direction', { direction: 'LONG' as Direction }],
    ['too few advancers', { advancers: 1 }],
    ['unchanged top-five member', { top5Unchanged: 1 }],
  ])('rejects %s', (_name, overrides) => {
    expect(evaluate(overrides)).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
      }),
    );
  });

  it('rejects when a required causal feature is missing', () => {
    const result = trendFollowAiAdapter.postProcessLocalAnalysis?.({
      signal: {
        direction: 'SHORT',
        prices: { takeProfitPrice: 90, stopLossPrice: 105 },
      } as Signal,
      payload: {
        additionalIndicators: { baseContext: {} },
      } as unknown as AiPayload,
      analysis: { direction: 'SHORT', quality: 5 },
    });

    expect(result).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
      }),
    );
  });
});
