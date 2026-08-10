import type { AiPayload, Signal, StrategyAiAdapter } from '@tradejs/types';
import {
  AI_GATE_REBUILD_OBSERVATION_REASON,
  makeObservationOnlyAiAdapter,
} from '../aiGateObservation';

const signal = {
  direction: 'LONG',
} as Signal;

const payload = {} as AiPayload;

describe('makeObservationOnlyAiAdapter', () => {
  it('records and rejects a legacy approval', () => {
    const legacyAdapter: StrategyAiAdapter = {
      postProcessAnalysis: ({ analysis }) => ({
        ...analysis,
        direction: 'LONG',
        quality: 5,
        approved: true,
      }),
    };

    const result = makeObservationOnlyAiAdapter(
      legacyAdapter,
    ).postProcessLocalAnalysis?.({
      signal,
      payload,
      analysis: { direction: 'LONG', quality: 5 },
    }) as Record<string, unknown>;

    expect(result).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 3,
        approved: false,
        needRetest: true,
        takeProfitPrice: null,
        stopLossPrice: null,
        gateDecision: 'rejected',
      }),
    );
    expect(result.rejectReason).toBe(
      `${AI_GATE_REBUILD_OBSERVATION_REASON}; legacyApproved=true; legacyQuality=5; legacyDirection=LONG`,
    );
  });

  it('preserves a stricter legacy quality while keeping the gate rejected', () => {
    const result = makeObservationOnlyAiAdapter().postProcessLocalAnalysis?.({
      signal,
      payload,
      analysis: { direction: null, quality: 1 },
    }) as Record<string, unknown>;

    expect(result).toEqual(
      expect.objectContaining({
        direction: null,
        quality: 1,
        approved: false,
      }),
    );
    expect(result.rejectReason).toBe(
      `${AI_GATE_REBUILD_OBSERVATION_REASON}; legacyApproved=false; legacyQuality=1; legacyDirection=null`,
    );
  });
});
