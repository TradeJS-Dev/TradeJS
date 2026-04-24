import {
  resolveDerivativesContextBackfillWindow,
  resolveDerivativesContextBackfillSymbols,
  shouldBackfillDerivativesContextForBacktest,
  shouldBackfillDerivativesContextForSignals,
} from '../lib/derivativesContextBackfill';

describe('shouldBackfillDerivativesContextForBacktest', () => {
  const originalContextEnabled = process.env.DERIVATIVES_CONTEXT_ENABLED;
  const originalLookbackHours = process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;

  beforeEach(() => {
    delete process.env.DERIVATIVES_CONTEXT_ENABLED;
    delete process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;
  });

  afterAll(() => {
    if (originalContextEnabled === undefined) {
      delete process.env.DERIVATIVES_CONTEXT_ENABLED;
    } else {
      process.env.DERIVATIVES_CONTEXT_ENABLED = originalContextEnabled;
    }

    if (originalLookbackHours === undefined) {
      delete process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;
    } else {
      process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = originalLookbackHours;
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

  it('does not backfill backtests when derivatives context is live-only', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'live';

    expect(
      shouldBackfillDerivativesContextForBacktest({
        aiEnabled: true,
        cacheOnly: false,
        mlEnabled: false,
      }),
    ).toBe(false);
  });
});

describe('shouldBackfillDerivativesContextForSignals', () => {
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

  it('does not backfill signals in cache-only mode', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';

    expect(
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: true,
      }),
    ).toBe(false);
  });

  it('backfills signals when derivatives context is enabled globally', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'true';

    expect(
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: false,
      }),
    ).toBe(true);
  });

  it('backfills signals only when live mode is enabled', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'live';

    expect(
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: false,
      }),
    ).toBe(true);

    process.env.DERIVATIVES_CONTEXT_ENABLED = 'backtest';

    expect(
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: false,
      }),
    ).toBe(false);
  });
});

describe('resolveDerivativesContextBackfillSymbols', () => {
  it('uses only BTC/ETH reference symbols for Coinalyze backfill', () => {
    expect(
      resolveDerivativesContextBackfillSymbols([
        'SOLUSDT',
        'XRPUSDT',
        'DOGEUSDT',
      ]),
    ).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
});

describe('resolveDerivativesContextBackfillWindow', () => {
  const originalLookbackHours = process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;

  beforeEach(() => {
    delete process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;
  });

  afterAll(() => {
    if (originalLookbackHours === undefined) {
      delete process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS;
    } else {
      process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = originalLookbackHours;
    }
  });

  it('caps the backfill start at explicit preload start', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '1000';
    const startMs = Date.parse('2026-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-02T00:00:00.000Z');
    const preloadStartMs = Date.parse('2026-03-02T00:00:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        startMs,
        endMs,
        preloadStartMs,
        nowMs: endMs,
      }),
    ).toEqual({
      fromMs: preloadStartMs,
      toMs: endMs,
      testStartMs: startMs,
    });
  });

  it('keeps the shorter derivatives lookback when preload starts earlier', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '12';
    const startMs = Date.parse('2026-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-02T00:00:00.000Z');
    const preloadStartMs = Date.parse('2026-03-02T00:00:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        startMs,
        endMs,
        preloadStartMs,
        nowMs: endMs,
      }),
    ).toEqual({
      fromMs: startMs - 12 * 60 * 60 * 1000,
      toMs: endMs,
      testStartMs: startMs,
    });
  });

  it('falls back to derivatives lookback before test start', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '12';
    const startMs = Date.parse('2026-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-02T00:00:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        startMs,
        endMs,
        nowMs: endMs,
      }),
    ).toEqual({
      fromMs: startMs - 12 * 60 * 60 * 1000,
      toMs: endMs,
      testStartMs: startMs,
    });
  });
});
