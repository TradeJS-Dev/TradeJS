import { headAndShouldersAiAdapter } from '../adapters/ai';

describe('HeadAndShoulders AI adapter', () => {
  it('copies strategy geometry into the AI payload', () => {
    const context = {
      patternKind: 'head_and_shoulders',
      shoulderDifferencePct: 5,
    };
    const payload = headAndShouldersAiAdapter.buildPayload?.({
      signal: {
        additionalIndicators: { headAndShouldersContext: context },
      } as any,
      basePayload: { additionalIndicators: { baseContext: {} } } as any,
    });

    expect((payload as any).additionalIndicators.headAndShouldersContext).toBe(
      context,
    );
  });
});
