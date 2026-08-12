import type { AiPayload, Signal, StrategyAiAdapter } from '@tradejs/types';
import { withStrategyLocalAiGateFilter } from '../localAiGate';

const signal = {
  direction: 'LONG',
  prices: { takeProfitPrice: 110, stopLossPrice: 95 },
} as Signal;
const payload = { additionalIndicators: {} } as AiPayload;

describe('withStrategyLocalAiGateFilter', () => {
  it('preserves an allowed prior approval without changing its quality', () => {
    const adapter = withStrategyLocalAiGateFilter({} as StrategyAiAdapter, {
      id: 'long_only',
      allows: ({ signal: currentSignal }) => currentSignal.direction === 'LONG',
    });

    expect(
      adapter.postProcessLocalAnalysis?.({
        signal,
        payload,
        analysis: { direction: 'LONG', quality: 5 },
      }),
    ).toEqual({ direction: 'LONG', quality: 5 });
  });

  it('rejects a disallowed prior approval', () => {
    const adapter = withStrategyLocalAiGateFilter({} as StrategyAiAdapter, {
      id: 'disabled_direction',
      allows: () => false,
    });

    expect(
      adapter.postProcessLocalAnalysis?.({
        signal,
        payload,
        analysis: { direction: 'LONG', quality: 5 },
      }),
    ).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        gateDecision: 'rejected',
        rejectReason: expect.stringContaining('rule=disabled_direction'),
      }),
    );
  });

  it('does not promote a prior rejection even when the filter allows it', () => {
    const adapter = withStrategyLocalAiGateFilter({} as StrategyAiAdapter, {
      id: 'keep_prior_decision',
      allows: () => true,
    });

    expect(
      adapter.postProcessLocalAnalysis?.({
        signal,
        payload,
        analysis: { direction: null, quality: 3 },
      }),
    ).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
      }),
    );
  });
});
