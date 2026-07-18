import {
  coinalyzePointsToRows,
  deriveCoinalyzeHourlyRowsFrom15m,
  getLastClosedDerivativesBarStartMs,
  mergeCoinalyzeMetrics,
  normalizeCoinalyzeSymbols,
  normalizeDerivativesIntervals,
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
});
