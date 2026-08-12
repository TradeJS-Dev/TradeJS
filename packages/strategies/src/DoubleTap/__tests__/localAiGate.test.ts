import type { AiPayload, Signal } from '@tradejs/types';
import { doubleTapAiAdapter } from '../adapters/ai';

const evaluate = ({
  direction = 'LONG',
  altDispersion24h,
  pricePositionInChannel,
  barsSinceSwingHigh,
}: {
  direction?: 'LONG' | 'SHORT';
  altDispersion24h?: number;
  pricePositionInChannel?: number;
  barsSinceSwingHigh?: number;
}) =>
  doubleTapAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction,
      prices: { takeProfitPrice: 110, stopLossPrice: 95 },
    } as Signal,
    payload: {
      additionalIndicators: {
        doubleTapContext: { altDispersion24h },
        baseContext: {
          regime: {
            trend: { adaptiveChannel: { pricePositionInChannel } },
          },
          structure: { pivots: { barsSinceSwingHigh } },
        },
      },
    } as unknown as AiPayload,
    analysis: { direction, quality: 5 },
  });

describe('DoubleTap local AI gate', () => {
  it('approves the calibrated boundary', () => {
    expect(
      evaluate({ altDispersion24h: 0.0285, pricePositionInChannel: 0.757 }),
    ).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it('preserves the calibrated SHORT edge', () => {
    expect(evaluate({ direction: 'SHORT', barsSinceSwingHigh: 47 })).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it.each([
    { altDispersion24h: 0.02849, pricePositionInChannel: 0.757 },
    { altDispersion24h: 0.0285, pricePositionInChannel: 0.75699 },
    { direction: 'SHORT' as const, barsSinceSwingHigh: 48 },
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
