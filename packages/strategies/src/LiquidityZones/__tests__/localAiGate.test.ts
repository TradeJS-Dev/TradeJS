import type { AiPayload, Signal } from '@tradejs/types';
import { liquidityZonesAiAdapter } from '../adapters/ai';

describe('LiquidityZones local AI gate', () => {
  it('rejects legacy approvals after the 1800d rebuild', () => {
    expect(
      liquidityZonesAiAdapter.postProcessLocalAnalysis?.({
        signal: {
          direction: 'LONG',
          prices: { takeProfitPrice: 110, stopLossPrice: 95 },
        } as Signal,
        payload: { additionalIndicators: {} } as AiPayload,
        analysis: { direction: 'LONG', quality: 5 },
      }),
    ).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
      }),
    );
  });
});
