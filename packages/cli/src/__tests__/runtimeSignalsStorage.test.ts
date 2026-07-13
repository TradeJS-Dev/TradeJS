import type { Signal } from '@tradejs/types';
import {
  buildRuntimeSignalStatsIncrements,
  DEFAULT_RUNTIME_SIGNAL_RETENTION_TTL_SECONDS,
  getRuntimeSignalRetentionTtlSeconds,
  getRuntimeStorageDayKey,
  getRuntimeStorageDayKeys,
  isRuntimeSignalBucketRef,
  normalizeRuntimeSignalSkipReason,
  parseRuntimeSignalStatsBucket,
  shouldStoreDetailedRuntimeSignalEvaluation,
  shouldStoreRuntimeSignalDiagnostics,
  toStoredRuntimeSignal,
  toRuntimeSignalBucketRef,
} from '../lib/runtimeSignalsStorage';

describe('runtimeSignalsStorage', () => {
  it('builds summary-aligned day keys and lightweight signal refs', () => {
    expect(getRuntimeStorageDayKey(Date.UTC(2026, 4, 2, 13, 45))).toBe(
      '2026-05-02',
    );
    expect(getRuntimeStorageDayKey(Date.UTC(2026, 4, 2, 17, 59))).toBe(
      '2026-05-02',
    );
    expect(getRuntimeStorageDayKey(Date.UTC(2026, 4, 2, 18, 0))).toBe(
      '2026-05-03',
    );
    expect(
      getRuntimeStorageDayKeys(
        Date.UTC(2026, 4, 1, 18, 0),
        Date.UTC(2026, 4, 2, 18, 0),
      ),
    ).toEqual(['2026-05-02']);

    const ref = toRuntimeSignalBucketRef({
      signalId: 'sig-1',
      symbol: 'BTCUSDT',
      strategy: 'TrendLine',
      timestamp: 1_700_000_000_000,
    } as any);

    expect(ref).toEqual({
      signalId: 'sig-1',
      symbol: 'BTCUSDT',
      strategy: 'TrendLine',
      timestamp: 1_700_000_000_000,
    });
    expect(isRuntimeSignalBucketRef(ref)).toBe(true);
    expect(isRuntimeSignalBucketRef({ signalId: 'sig-1' })).toBe(false);
  });

  it('stores heavy diagnostics only for completed or failed orders', () => {
    const diagnostics = {
      figures: { debug: [{ id: 'line-1' }] },
      indicators: { atr: [1, 2, 3] },
      additionalIndicators: { baseContext: { regime: 'trend' } },
    };
    const makeSignal = (orderStatus?: Signal['orderStatus']) =>
      ({
        signalId: 'sig-1',
        symbol: 'BTCUSDT',
        strategy: 'TrendLine',
        interval: '15',
        direction: 'LONG',
        timestamp: 1_700_000_000_000,
        prices: {
          currentPrice: 100,
          takeProfitPrice: 110,
          stopLossPrice: 95,
          riskRatio: 2,
        },
        orderStatus,
        ...diagnostics,
      }) as Signal;

    for (const orderStatus of [undefined, 'skipped', 'canceled'] as const) {
      const signal = makeSignal(orderStatus);
      expect(shouldStoreRuntimeSignalDiagnostics(signal)).toBe(false);
      const stored = toStoredRuntimeSignal(signal);
      expect(stored).not.toHaveProperty('figures');
      expect(stored).not.toHaveProperty('indicators');
      expect(stored).not.toHaveProperty('additionalIndicators');
    }

    for (const orderStatus of ['completed', 'failed'] as const) {
      const signal = makeSignal(orderStatus);
      expect(shouldStoreRuntimeSignalDiagnostics(signal)).toBe(true);
      expect(toStoredRuntimeSignal(signal)).toEqual(
        expect.objectContaining(diagnostics),
      );
    }
  });

  it('normalizes skip reasons into stable source and reason buckets', () => {
    expect(
      normalizeRuntimeSignalSkipReason('AI_QUALITY_BELOW_MIN (2 < 3)', 'core'),
    ).toEqual({
      source: 'skip from AI',
      reason: 'MIN_AI_QUALITY',
    });
    expect(
      normalizeRuntimeSignalSkipReason(
        'ML_THRESHOLD_NOT_MET (0.4 < 0.5)',
        'runtime',
      ),
    ).toEqual({
      source: 'skip from ML',
      reason: 'ML_THRESHOLD',
    });
    expect(
      normalizeRuntimeSignalSkipReason(
        'HOOK_BEFORE_ENTRY_GATE:POSITION_LIMIT',
        'runtime',
      ),
    ).toEqual({
      source: 'skip from hook',
      reason: 'BEFORE_ENTRY_GATE:POSITION_LIMIT',
    });
    expect(
      normalizeRuntimeSignalSkipReason('ENTRY_POLICY_BLOCKED', 'runtime'),
    ).toEqual({
      source: 'skip from policy',
      reason: 'ENTRY_POLICY_BLOCKED',
    });
  });

  it('builds stats increments for signal, skip, and error evaluations', () => {
    expect(
      buildRuntimeSignalStatsIncrements({
        evaluationId: 'eval-1',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1_700_000_000_000,
        evaluatedAt: 1_700_000_000_000,
        status: 'signal',
        signalId: 'sig-1',
        direction: 'LONG',
        orderStatus: 'completed',
      }),
    ).toEqual({
      evaluated: 1,
      signals: 1,
    });

    expect(
      buildRuntimeSignalStatsIncrements({
        evaluationId: 'eval-2',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1_700_000_000_000,
        evaluatedAt: 1_700_000_000_000,
        status: 'signal',
        signalId: 'sig-2',
        direction: 'LONG',
        orderStatus: 'skipped',
        orderSkipReason: 'AI_QUALITY_BELOW_MIN (0 < 4)',
      }),
    ).toEqual({
      evaluated: 1,
      signals: 1,
      'reason:skip from AI:MIN_AI_QUALITY': 1,
    });

    expect(
      buildRuntimeSignalStatsIncrements({
        evaluationId: 'eval-3',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1_700_000_000_000,
        evaluatedAt: 1_700_000_000_000,
        status: 'skip',
        reason: 'NO_SIGNAL',
      }),
    ).toEqual({
      evaluated: 1,
      'reason:skip from core:NO_SIGNAL': 1,
    });

    expect(
      buildRuntimeSignalStatsIncrements({
        evaluationId: 'eval-4',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1_700_000_000_000,
        evaluatedAt: 1_700_000_000_000,
        status: 'error',
        reason: 'FETCH_FAILED',
      }),
    ).toEqual({
      evaluated: 1,
      'reason:skip from runtime:FETCH_FAILED': 1,
    });
  });

  it('parses persisted stats buckets back into summary-friendly maps', () => {
    const parsed = parseRuntimeSignalStatsBucket({
      evaluated: '33',
      signals: '2',
      'reason:skip from core:NO_SIGNAL': '30',
      'reason:skip from AI:MIN_AI_QUALITY': '1',
      'reason:skip from runtime:FETCH_FAILED': '2',
    });

    expect(parsed.evaluated).toBe(33);
    expect(parsed.signals).toBe(2);
    expect(parsed.reasonGroups.get('skip from core')?.get('NO_SIGNAL')).toBe(
      30,
    );
    expect(parsed.reasonGroups.get('skip from AI')?.get('MIN_AI_QUALITY')).toBe(
      1,
    );
    expect(
      parsed.reasonGroups.get('skip from runtime')?.get('FETCH_FAILED'),
    ).toBe(2);
  });

  it('stores detailed evaluation rows only for signal/error events', () => {
    expect(
      shouldStoreDetailedRuntimeSignalEvaluation({
        evaluationId: 'eval-1',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1,
        evaluatedAt: 1,
        status: 'signal',
      }),
    ).toBe(true);
    expect(
      shouldStoreDetailedRuntimeSignalEvaluation({
        evaluationId: 'eval-2',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1,
        evaluatedAt: 1,
        status: 'error',
      }),
    ).toBe(true);
    expect(
      shouldStoreDetailedRuntimeSignalEvaluation({
        evaluationId: 'eval-3',
        userName: 'root',
        strategy: 'TrendLine',
        symbol: 'BTCUSDT',
        interval: '15',
        timestamp: 1,
        evaluatedAt: 1,
        status: 'skip',
        reason: 'NO_SIGNAL',
      }),
    ).toBe(false);
  });
});

describe('runtimeSignalsStorage retention', () => {
  const originalDays = process.env.RUNTIME_SIGNAL_RETENTION_DAYS;

  afterEach(() => {
    if (originalDays == null) {
      delete process.env.RUNTIME_SIGNAL_RETENTION_DAYS;
    } else {
      process.env.RUNTIME_SIGNAL_RETENTION_DAYS = originalDays;
    }
  });

  it('uses default retention when env override is absent or invalid', () => {
    process.env.RUNTIME_SIGNAL_RETENTION_DAYS = 'bad';

    expect(getRuntimeSignalRetentionTtlSeconds()).toBe(
      DEFAULT_RUNTIME_SIGNAL_RETENTION_TTL_SECONDS,
    );
  });

  it('resolves retention from days env', () => {
    process.env.RUNTIME_SIGNAL_RETENTION_DAYS = '3';

    expect(getRuntimeSignalRetentionTtlSeconds()).toBe(259_200);
  });
});
