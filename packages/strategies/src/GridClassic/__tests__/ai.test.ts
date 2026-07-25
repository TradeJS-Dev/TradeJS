/** @jest-environment node */

import { gridClassicAiAdapter } from '../adapters/ai';

describe('GridClassic AI adapter', () => {
  it('preserves strategy-specific range and grid context for future exports', () => {
    const context = {
      direction: 'LONG',
      widthAtr: 8,
      containmentRatio: 0.9,
      gridLevel: 2,
      remainingLevels: 2,
    };
    const payload = gridClassicAiAdapter.buildPayload!({
      signal: {
        additionalIndicators: { gridClassicContext: context },
      },
      basePayload: {
        additionalIndicators: {
          baseContext: { raw: {} },
        },
      },
    } as any);

    expect((payload.additionalIndicators as any).gridClassicContext).toEqual(
      context,
    );
    expect((payload.additionalIndicators as any).baseContext).toEqual({
      raw: {},
    });
  });
});
