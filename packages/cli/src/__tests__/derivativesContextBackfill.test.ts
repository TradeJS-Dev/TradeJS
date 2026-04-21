import { shouldBackfillDerivativesContextForBacktest } from '../lib/derivativesContextBackfill';

describe('shouldBackfillDerivativesContextForBacktest', () => {
  const originalContextEnabled = process.env.DERIVATIVES_CONTEXT_ENABLED;

  beforeEach(() => {
    delete process.env.DERIVATIVES_CONTEXT_ENABLED;
  });

  afterAll(() => {
    if (originalContextEnabled === undefined) {
      delete process.env.DERIVATIVES_CONTEXT_ENABLED;
    } else {
      process.env.DERIVATIVES_CONTEXT_ENABLED = originalContextEnabled;
    }
  });

  it('does not backfill derivatives context for cache-only backtests', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';

    expect(
      shouldBackfillDerivativesContextForBacktest({
        aiEnabled: true,
        cacheOnly: true,
        mlEnabled: true,
      }),
    ).toBe(false);
  });

  it('backfills derivatives context only when enabled for AI or ML backtests', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';

    expect(
      shouldBackfillDerivativesContextForBacktest({
        aiEnabled: false,
        cacheOnly: false,
        mlEnabled: true,
      }),
    ).toBe(true);

    expect(
      shouldBackfillDerivativesContextForBacktest({
        aiEnabled: false,
        cacheOnly: false,
        mlEnabled: false,
      }),
    ).toBe(false);
  });
});
