import {
  buildCoinalyzeHourlyRowsWithFallback,
  coinalyzePointsToRows,
  deriveCoinalyzeHourlyRowsFrom15m,
  deriveCoinalyzeRollingHourlyRowsFrom15m,
  getLastClosedDerivativesBarStartMs,
  mergeCoinalyzeMetrics,
  normalizeCoinalyzeSymbols,
  normalizeDerivativesIntervals,
  resolveCoinalyzeConfirmedIntradayCoverage,
  toArrayData,
  toCoinalyzeTimestampMs,
  toFiniteNumber,
} from '../derivativesCoinalyze';
import type { DerivativesRow } from '@tradejs/types';

describe('derivativesCoinalyze utils', () => {
  test('normalizeCoinalyzeSymbols trims, uppercases and drops empty values', () => {
    expect(normalizeCoinalyzeSymbols(' btcusdt, ETHUSDT, , solusdt ')).toEqual([
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
    ]);
  });

  test('normalizeDerivativesIntervals keeps only supported values', () => {
    expect(normalizeDerivativesIntervals('15m, 1h,5m,foo')).toEqual([
      '15m',
      '1h',
    ]);
  });

  test('toCoinalyzeTimestampMs supports seconds, milliseconds and microseconds', () => {
    expect(toCoinalyzeTimestampMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toCoinalyzeTimestampMs(1_700_000_000_123)).toBe(1_700_000_000_123);
    expect(toCoinalyzeTimestampMs(1_700_000_000_123_000)).toBe(
      1_700_000_000_123,
    );
    expect(toCoinalyzeTimestampMs('abc')).toBeNull();
  });

  test('toFiniteNumber converts numeric values and rejects invalid', () => {
    expect(toFiniteNumber('12.5')).toBe(12.5);
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber('NaN')).toBeNull();
  });

  test('toArrayData supports bare array and object-wrapped arrays', () => {
    expect(toArrayData<number>([1, 2])).toEqual([1, 2]);
    expect(toArrayData<number>({ data: [3, 4] })).toEqual([3, 4]);
    expect(toArrayData<number>({ result: [5] })).toEqual([5]);
    expect(toArrayData<number>({})).toEqual([]);
  });

  test('mergeCoinalyzeMetrics joins oi/funding/liq by timestamp and computes liqTotal fallback', () => {
    const ts = 1_700_000_000;
    const points = mergeCoinalyzeMetrics({
      symbol: 'BTCUSDT',
      oiRaw: [{ t: ts, open_interest: 1000 }],
      fundingRaw: { data: [{ timestamp: ts, funding_rate: 0.0002 }] },
      liqRaw: { result: [{ ts, liq_long: 120, liq_short: 80 }] },
    });

    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      symbol: 'BTCUSDT',
      ts: ts * 1000,
      openInterest: 1000,
      fundingRate: 0.0002,
      liqLong: 120,
      liqShort: 80,
      liqTotal: 200,
    });
  });

  test('coinalyzePointsToRows maps points to DerivativesRow with null defaults', () => {
    const rows = coinalyzePointsToRows(
      [
        {
          symbol: 'ETHUSDT',
          ts: 1_700_000_000_000,
          openInterest: 2000,
        },
      ],
      '15m',
      'coinalyze',
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('ETHUSDT');
    expect(rows[0].interval).toBe('15m');
    expect(rows[0].source).toBe('coinalyze');
    expect(rows[0].ts instanceof Date).toBe(true);
    expect(rows[0].openInterest).toBe(2000);
    expect(rows[0].fundingRate).toBeNull();
    expect(rows[0].liqTotal).toBeNull();
  });

  test('getLastClosedDerivativesBarStartMs resolves the bar that just closed', () => {
    const boundary = Date.parse('2026-07-15T13:00:00.000Z');

    expect(getLastClosedDerivativesBarStartMs(boundary, '15m')).toBe(
      Date.parse('2026-07-15T12:45:00.000Z'),
    );
    expect(getLastClosedDerivativesBarStartMs(boundary + 5_000, '15m')).toBe(
      Date.parse('2026-07-15T12:45:00.000Z'),
    );
  });

  test('resolveCoinalyzeConfirmedIntradayCoverage keeps only the guaranteed intraday retention tail', () => {
    const nowMs = Date.parse('2026-07-20T12:07:00.000Z');
    const lastClosedStartMs = Date.parse('2026-07-20T11:45:00.000Z');

    expect(
      resolveCoinalyzeConfirmedIntradayCoverage({
        interval: '15m',
        fromMs: Date.parse('2026-01-01T00:00:00.000Z'),
        toMs: nowMs,
        nowMs,
      }),
    ).toEqual({
      fromMs: lastClosedStartMs - 1_499 * 15 * 60 * 1000,
      toMs: lastClosedStartMs,
    });
  });

  test('resolveCoinalyzeConfirmedIntradayCoverage does not claim expired historical windows', () => {
    const nowMs = Date.parse('2026-07-20T12:07:00.000Z');

    expect(
      resolveCoinalyzeConfirmedIntradayCoverage({
        interval: '15m',
        fromMs: Date.parse('2026-03-01T00:00:00.000Z'),
        toMs: Date.parse('2026-03-02T00:00:00.000Z'),
        nowMs,
      }),
    ).toBeNull();
  });

  test('deriveCoinalyzeHourlyRowsFrom15m builds complete hours with metric-aware aggregation', () => {
    const hourStart = Date.parse('2026-07-15T12:00:00.000Z');
    const rows: DerivativesRow[] = [0, 1, 2, 3].map((offset) => ({
      symbol: 'BTCUSDT',
      interval: '15m',
      ts: new Date(hourStart + offset * 15 * 60 * 1000),
      openInterest: 100 + offset,
      fundingRate: 0.0001 * (offset + 1),
      liqLong: 10 + offset,
      liqShort: 20 + offset,
      liqTotal: offset === 2 ? null : 30 + 2 * offset,
      source: 'coinalyze',
    }));

    expect(deriveCoinalyzeHourlyRowsFrom15m(rows)).toEqual([
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        ts: new Date(hourStart),
        openInterest: 103,
        fundingRate: 0.0004,
        liqLong: 46,
        liqShort: 86,
        liqTotal: 132,
        source: 'coinalyze',
      },
    ]);
  });

  test('deriveCoinalyzeHourlyRowsFrom15m omits incomplete hours', () => {
    const hourStart = Date.parse('2026-07-15T12:00:00.000Z');
    const rows: DerivativesRow[] = [0, 1, 3].map((offset) => ({
      symbol: 'BTCUSDT',
      interval: '15m',
      ts: new Date(hourStart + offset * 15 * 60 * 1000),
      openInterest: 100 + offset,
      source: 'coinalyze',
    }));

    expect(deriveCoinalyzeHourlyRowsFrom15m(rows)).toEqual([]);
  });

  test('deriveCoinalyzeRollingHourlyRowsFrom15m builds a trailing hour at every 15m point', () => {
    const hourStart = Date.parse('2026-07-15T12:00:00.000Z');
    const rows: DerivativesRow[] = [-3, -2, -1, 0, 1, 2, 3].map((offset) => ({
      symbol: 'BTCUSDT',
      interval: '15m',
      ts: new Date(hourStart + offset * 15 * 60 * 1000),
      openInterest: 100 + offset,
      fundingRate: 0.0001 * (offset + 4),
      liqLong: 10 + offset,
      liqShort: 20 + offset,
      liqTotal: 30 + 2 * offset,
      source: 'coinalyze',
    }));

    expect(deriveCoinalyzeRollingHourlyRowsFrom15m(rows)).toEqual(
      [0, 1, 2, 3].map((offset) => ({
        symbol: 'BTCUSDT',
        interval: '1h',
        ts: new Date(hourStart + offset * 15 * 60 * 1000),
        openInterest: 100 + offset,
        fundingRate: 0.0001 * (offset + 4),
        liqLong: 34 + 4 * offset,
        liqShort: 74 + 4 * offset,
        liqTotal: 108 + 8 * offset,
        source: 'coinalyze:rolling_15m',
      })),
    );
  });

  test('buildCoinalyzeHourlyRowsWithFallback keeps legacy 1h when no rolling 15m window exists', () => {
    const hourStart = Date.parse('2026-07-15T12:00:00.000Z');
    const fallback: DerivativesRow = {
      symbol: 'BTCUSDT',
      interval: '1h',
      ts: new Date(hourStart),
      openInterest: 200,
      source: 'coinalyze',
    };

    expect(
      buildCoinalyzeHourlyRowsWithFallback({
        rows15m: [],
        fallbackRows1h: [fallback],
      }),
    ).toEqual([
      {
        ...fallback,
        source: 'coinalyze:legacy_1h_fallback',
      },
    ]);
  });

  test('buildCoinalyzeHourlyRowsWithFallback prefers rolling 15m without mixing legacy metrics', () => {
    const hourStart = Date.parse('2026-07-15T12:00:00.000Z');
    const rows15m: DerivativesRow[] = [0, 1, 2, 3].map((offset) => ({
      symbol: 'BTCUSDT',
      interval: '15m',
      ts: new Date(hourStart + offset * 15 * 60 * 1000),
      openInterest: offset === 3 ? null : 100 + offset,
      fundingRate: 0.0001 * (offset + 1),
      liqLong: 10 + offset,
      liqShort: 20 + offset,
      liqTotal: 30 + 2 * offset,
      source: 'coinalyze',
    }));
    const fallbackRows: DerivativesRow[] = [
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        ts: new Date(hourStart - 60 * 60 * 1000),
        openInterest: 500,
        source: 'coinalyze',
      },
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        ts: new Date(hourStart),
        openInterest: 999,
        fundingRate: 9,
        liqLong: 999,
        liqShort: 999,
        liqTotal: 1998,
        source: 'coinalyze',
      },
    ];

    expect(
      buildCoinalyzeHourlyRowsWithFallback({
        rows15m,
        fallbackRows1h: fallbackRows,
      }),
    ).toEqual([
      {
        ...fallbackRows[0],
        source: 'coinalyze:legacy_1h_fallback',
      },
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        ts: new Date(hourStart + 45 * 60 * 1000),
        openInterest: null,
        fundingRate: 0.0004,
        liqLong: 46,
        liqShort: 86,
        liqTotal: 132,
        source: 'coinalyze:rolling_15m',
      },
    ]);
  });
});
