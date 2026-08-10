import type { AiPayload, Signal } from '@tradejs/types';
import { adaptiveMomentumRibbonAiAdapter } from '../adapters/ai';

const evaluate = ({
  direction = 'LONG',
  unchanged,
  pointOfControlVolumeShare,
}: {
  direction?: 'LONG' | 'SHORT';
  unchanged?: number;
  pointOfControlVolumeShare?: number;
}) =>
  adaptiveMomentumRibbonAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction,
      prices: { takeProfitPrice: 110, stopLossPrice: 95 },
    } as Signal,
    payload: {
      additionalIndicators: {
        baseContext: {
          relative: { marketBreadths: { top100: { unchanged } } },
          participation: {
            volumeStructure: { pointOfControlVolumeShare },
          },
        },
      },
    } as unknown as AiPayload,
    analysis: { direction, quality: 5 },
  });

describe('AdaptiveMomentumRibbon local AI gate', () => {
  it('approves the calibrated boundary', () => {
    expect(
      evaluate({ unchanged: 10, pointOfControlVolumeShare: 0.166 }),
    ).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it.each([
    { unchanged: 9, pointOfControlVolumeShare: 0.166 },
    { unchanged: 10, pointOfControlVolumeShare: 0.16601 },
    {
      direction: 'SHORT' as const,
      unchanged: 10,
      pointOfControlVolumeShare: 0.166,
    },
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
