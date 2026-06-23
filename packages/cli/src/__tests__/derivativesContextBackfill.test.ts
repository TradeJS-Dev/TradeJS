import {
  resolveDerivativesContextIntervalBackfillWindow,
  resolveDerivativesContextMissingFetchFromMs,
  resolveDerivativesContextMissingCoverageFetchFromMs,
  resolveDerivativesContextBackfillWindow,
  resolveDerivativesContextBackfillSymbols,
  groupDerivativesContextMissingFetchRanges,
  hasDerivativesContextCoverageRange,
  formatCoinalyzeRequestError,
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

  it('backfills derivatives context by default for AI or ML backtests', () => {
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

  it('can be disabled explicitly for backtests', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'false';

    expect(
      shouldBackfillDerivativesContextForBacktest({
        aiEnabled: true,
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

  it('backfills signals by default', () => {
    expect(
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: false,
      }),
    ).toBe(true);
  });

  it('can be disabled explicitly for signals', () => {
    process.env.DERIVATIVES_CONTEXT_ENABLED = 'false';

    expect(
      shouldBackfillDerivativesContextForSignals({
        cacheOnly: false,
      }),
    ).toBe(false);
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
  const originalTargetContextEnabled =
    process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED;

  beforeEach(() => {
    delete process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED;
  });

  afterAll(() => {
    if (originalTargetContextEnabled === undefined) {
      delete process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED;
    } else {
      process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED =
        originalTargetContextEnabled;
    }
  });

  it('uses only BTC/ETH reference symbols for Coinalyze backfill', () => {
    expect(
      resolveDerivativesContextBackfillSymbols([
        'SOLUSDT',
        'XRPUSDT',
        'DOGEUSDT',
      ]),
    ).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('includes requested target symbols when target derivatives context is enabled', () => {
    process.env.DERIVATIVES_CONTEXT_TARGET_ENABLED = 'true';

    expect(
      resolveDerivativesContextBackfillSymbols([
        'SOLUSDT',
        'BTCUSDT',
        'xrpusdt',
        'SOLUSDT',
      ]),
    ).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT']);
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

  it('caps backtest backfill start at explicit preload start', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '1000';
    const startMs = Date.parse('2026-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-02T00:00:00.000Z');
    const preloadStartMs = Date.parse('2026-03-02T00:00:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        mode: 'backtest',
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

  it('ignores explicit preload start for signals backfill', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '12';
    const startMs = Date.parse('2026-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-02T00:00:00.000Z');
    const preloadStartMs = Date.parse('2026-03-02T00:00:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        mode: 'signals',
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

  it('uses the whole requested test window for backtests without explicit preload', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '12';
    const startMs = Date.parse('2024-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-02T00:00:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        mode: 'backtest',
        startMs,
        endMs,
        nowMs: endMs,
      }),
    ).toEqual({
      fromMs: startMs,
      toMs: endMs,
      testStartMs: startMs,
    });
  });

  it('keeps signal backfill on the short derivatives lookback window', () => {
    process.env.DERIVATIVES_CONTEXT_LOOKBACK_HOURS = '12';
    const startMs = Date.parse('2026-04-01T00:00:00.000Z');
    const endMs = Date.parse('2026-04-01T00:15:00.000Z');

    expect(
      resolveDerivativesContextBackfillWindow({
        mode: 'signals',
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

describe('resolveDerivativesContextIntervalBackfillWindow', () => {
  it('aligns backfill bounds to closed derivatives intervals', () => {
    const fromMs = Date.parse('2026-05-25T09:32:31.000Z');
    const toMs = Date.parse('2026-05-25T10:37:31.000Z');

    expect(
      resolveDerivativesContextIntervalBackfillWindow({
        fromMs,
        toMs,
        interval: '15m',
      }),
    ).toEqual({
      fromMs: Date.parse('2026-05-25T09:30:00.000Z'),
      toMs: Date.parse('2026-05-25T10:30:00.000Z'),
      intervalMs: 15 * 60 * 1000,
    });

    expect(
      resolveDerivativesContextIntervalBackfillWindow({
        fromMs,
        toMs,
        interval: '1h',
      }),
    ).toEqual({
      fromMs: Date.parse('2026-05-25T09:00:00.000Z'),
      toMs: Date.parse('2026-05-25T10:00:00.000Z'),
      intervalMs: 60 * 60 * 1000,
    });
  });
});

describe('resolveDerivativesContextMissingFetchFromMs', () => {
  it('fetches only the missing tail when a window is partially covered', () => {
    expect(
      resolveDerivativesContextMissingFetchFromMs({
        edges: { min: 1_000, max: 10_000 },
        fromMs: 1_000,
        toMs: 20_000,
        intervalMs: 1_000,
      }),
    ).toBe(11_000);
  });

  it('returns null when the existing derivatives data covers the window', () => {
    expect(
      resolveDerivativesContextMissingFetchFromMs({
        edges: { min: 1_000, max: 20_000 },
        fromMs: 2_000,
        toMs: 20_000,
        intervalMs: 1_000,
      }),
    ).toBeNull();
  });
});

describe('hasDerivativesContextCoverageRange', () => {
  it('treats zero-row coverage ranges as covering nested windows', () => {
    expect(
      hasDerivativesContextCoverageRange(
        [{ fromMs: 1_000, toMs: 10_000 }],
        2_000,
        9_000,
      ),
    ).toBe(true);
  });

  it('does not cover windows that extend outside the recorded range', () => {
    expect(
      hasDerivativesContextCoverageRange(
        [{ fromMs: 1_000, toMs: 10_000 }],
        500,
        9_000,
      ),
    ).toBe(false);
    expect(
      hasDerivativesContextCoverageRange(
        [{ fromMs: 1_000, toMs: 10_000 }],
        2_000,
        11_000,
      ),
    ).toBe(false);
  });
});

describe('resolveDerivativesContextMissingCoverageFetchFromMs', () => {
  it('skips windows fully covered by zero-row coverage ranges', () => {
    expect(
      resolveDerivativesContextMissingCoverageFetchFromMs({
        ranges: [{ fromMs: 1_000, toMs: 10_000 }],
        fromMs: 2_000,
        toMs: 9_000,
        intervalMs: 1_000,
      }),
    ).toBeNull();
  });

  it('fetches only the uncovered tail after a prior zero-row coverage range', () => {
    expect(
      resolveDerivativesContextMissingCoverageFetchFromMs({
        ranges: [{ fromMs: 1_000, toMs: 10_000 }],
        fromMs: 2_000,
        toMs: 12_000,
        intervalMs: 1_000,
      }),
    ).toBe(11_000);
  });

  it('uses the request start when coverage does not include the beginning', () => {
    expect(
      resolveDerivativesContextMissingCoverageFetchFromMs({
        ranges: [{ fromMs: 5_000, toMs: 10_000 }],
        fromMs: 2_000,
        toMs: 9_000,
        intervalMs: 1_000,
      }),
    ).toBe(2_000);
  });

  it('merges adjacent coverage ranges before deciding the missing tail', () => {
    expect(
      resolveDerivativesContextMissingCoverageFetchFromMs({
        ranges: [
          { fromMs: 6_000, toMs: 10_000 },
          { fromMs: 1_000, toMs: 5_000 },
        ],
        fromMs: 1_000,
        toMs: 12_000,
        intervalMs: 1_000,
      }),
    ).toBe(11_000);
  });
});

describe('groupDerivativesContextMissingFetchRanges', () => {
  it('groups missing symbols by fetch start to avoid broad batch refetches', () => {
    expect(
      groupDerivativesContextMissingFetchRanges([
        { item: 'tail-a', fromMs: 10_000 },
        { item: 'full-a', fromMs: 1_000 },
        { item: 'tail-b', fromMs: 10_000 },
      ]),
    ).toEqual([
      { fromMs: 1_000, items: ['full-a'] },
      { fromMs: 10_000, items: ['tail-a', 'tail-b'] },
    ]);
  });
});

describe('formatCoinalyzeRequestError', () => {
  it('formats nested fetch timeout errors without raw undici stack noise', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('Connect Timeout Error'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    });
    const message = formatCoinalyzeRequestError({
      url: 'https://api.coinalyze.net/v1/future-markets',
      error,
      attempts: 5,
      timeoutMs: 10_000,
    });

    expect(message).toContain(
      'Coinalyze request failed: https://api.coinalyze.net/v1/future-markets',
    );
    expect(message).toContain('cause=UND_ERR_CONNECT_TIMEOUT');
    expect(message).toContain('attempts=5');
    expect(message).toContain('timeout=10000ms');
    expect(message).toContain('DERIVATIVES_CONTEXT_ENABLED=live');
    expect(message).not.toContain('at ');
  });
});
