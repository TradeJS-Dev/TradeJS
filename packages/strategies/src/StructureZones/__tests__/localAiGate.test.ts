import type { AiPayload, Signal } from '@tradejs/types';
import { structureZonesAiAdapter } from '../adapters/ai';

const evaluate = ({
  mtfAlignment,
  decliners,
}: {
  mtfAlignment?: string;
  decliners?: number;
}) =>
  structureZonesAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction: 'LONG',
      prices: { takeProfitPrice: 110, stopLossPrice: 95 },
    } as Signal,
    payload: {
      additionalIndicators: {
        baseContext: {
          mtf: { summary: { mtfAlignment } },
          relative: { marketBreadths: { top50: { decliners } } },
        },
      },
    } as unknown as AiPayload,
    analysis: { direction: 'LONG', quality: 5 },
  });

describe('StructureZones local AI gate', () => {
  it('approves the calibrated boundary', () => {
    expect(evaluate({ mtfAlignment: 'aligned_bull', decliners: 1 })).toEqual(
      expect.objectContaining({
        direction: 'LONG',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it.each([
    { mtfAlignment: 'aligned_bull', decliners: 0 },
    { mtfAlignment: 'aligned_bear', decliners: 1 },
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
