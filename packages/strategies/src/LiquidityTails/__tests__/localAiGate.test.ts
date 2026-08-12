import type { AiPayload, Direction, Signal } from '@tradejs/types';
import { liquidityTailsAiAdapter } from '../adapters/ai';

const evaluate = (direction: Direction) =>
  liquidityTailsAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction,
      prices: { takeProfitPrice: 110, stopLossPrice: 95 },
    } as Signal,
    payload: { additionalIndicators: {} } as AiPayload,
    analysis: { direction, quality: 5 },
  });

describe('LiquidityTails local AI gate direction filter', () => {
  it('preserves approved LONG analyses', () => {
    expect(evaluate('LONG')).toEqual({ direction: 'LONG', quality: 5 });
  });

  it('rejects approved SHORT analyses', () => {
    expect(evaluate('SHORT')).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
      }),
    );
  });
});
