import type { AiPayload, Signal } from '@tradejs/types';
import { relativeRotationAiAdapter } from '../adapters/ai';

const evaluate = ({
  direction = 'SHORT',
  centerlineSlope,
  trxLiquidationImbalance,
}: {
  direction?: 'LONG' | 'SHORT';
  centerlineSlope?: number;
  trxLiquidationImbalance?: number;
}) =>
  relativeRotationAiAdapter.postProcessLocalAnalysis?.({
    signal: {
      direction,
      prices: { takeProfitPrice: 90, stopLossPrice: 105 },
    } as Signal,
    payload: {
      additionalIndicators: {
        baseContext: {
          regime: { trend: { adaptiveChannel: { centerlineSlope } } },
          derivatives: {
            referenceContexts: {
              TRXUSDT: {
                intervals: {
                  '1h': { liqImbalance: trxLiquidationImbalance },
                },
              },
            },
          },
        },
      },
    } as unknown as AiPayload,
    analysis: { direction, quality: 5 },
  });

describe('RelativeRotation local AI gate', () => {
  it('approves the calibrated boundary', () => {
    expect(
      evaluate({ centerlineSlope: -0.0002, trxLiquidationImbalance: 0.17 }),
    ).toEqual(
      expect.objectContaining({
        direction: 'SHORT',
        quality: 4,
        approved: true,
        gateDecision: 'approved',
      }),
    );
  });

  it.each([
    { centerlineSlope: -0.00019, trxLiquidationImbalance: 0.17 },
    { centerlineSlope: -0.0002, trxLiquidationImbalance: 0.16999 },
    {
      direction: 'LONG' as const,
      centerlineSlope: -0.0002,
      trxLiquidationImbalance: 0.17,
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
