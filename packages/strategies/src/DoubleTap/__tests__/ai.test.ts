import { doubleTapAiAdapter } from '../adapters/ai';

describe('doubleTapAiAdapter', () => {
  it('copies DoubleTap context into AI payload', () => {
    const result = doubleTapAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: {
          doubleTapContext: {
            patternKind: 'double_bottom',
            signalDirection: 'LONG',
          },
        },
      } as any,
      basePayload: {
        additionalIndicators: {
          baseContext: {},
        },
      } as any,
    } as any);

    expect((result as any).additionalIndicators.doubleTapContext).toEqual({
      patternKind: 'double_bottom',
      signalDirection: 'LONG',
    });
  });

  it('approves compact neckline breakouts for local gate mode', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'SHORT',
            height: 10,
            breakoutDistancePct: 0.5,
          },
        },
      },
      analysis: {
        approved: false,
        quality: 1,
        direction: null,
      },
    } as any);

    expect((result as any)?.direction).toBe('SHORT');
    expect(result?.quality).toBe(4);
    expect(result?.direction).toBe('SHORT');
  });

  it('rejects extended breakouts', () => {
    const result = doubleTapAiAdapter.postProcessAnalysis?.({
      payload: {
        additionalIndicators: {
          doubleTapContext: {
            signalDirection: 'LONG',
            height: 10,
            breakoutDistancePct: 3,
          },
        },
      },
      analysis: {
        approved: true,
        quality: 5,
        direction: 'LONG',
      },
    } as any);

    expect(result?.quality).toBe(1);
    expect(result?.direction).toBeNull();
  });
});
