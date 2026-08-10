import type { AiPayload, Signal } from '@tradejs/types';
import { doubleTapAiAdapter } from '../adapters/ai';

const evaluate = ({
  direction = 'LONG',
  altDispersion24h,
  roc1h,
}: {
  direction?: 'LONG' | 'SHORT';
  altDispersion24h?: number;
  roc1h?: number;
}) =>
  doubleTapAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction,
      prices: { takeProfitPrice: 110, stopLossPrice: 95 },
    } as Signal,
    payload: {
      additionalIndicators: {
        doubleTapContext: { altDispersion24h },
        baseContext: { regime: { momentum: { roc1h } } },
      },
    } as unknown as AiPayload,
    analysis: { direction, quality: 5 },
  });

describe('DoubleTap local AI gate', () => {
  it('approves the calibrated boundary', () => {
    expect(evaluate({ altDispersion24h: 0.032, roc1h: 0 })).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it.each([
    { altDispersion24h: 0.03199, roc1h: 0 },
    { altDispersion24h: 0.032, roc1h: -0.00001 },
    { direction: 'SHORT' as const, altDispersion24h: 0.032, roc1h: 0 },
    {},
  ])('rejects outside the calibrated pocket: %p', (input) => {
    expect(evaluate(input)).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
      }),
    );
  });
});
