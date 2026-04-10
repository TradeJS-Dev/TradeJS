import {
  binarySearchLatestByTs,
  parseDerivativesIntervals,
  toFiniteNumber,
  toTimestampMs,
} from '../derivativesFeatureUtils';

describe('derivativesFeatureUtils', () => {
  test('parseDerivativesIntervals keeps only 15m/1h', () => {
    expect(parseDerivativesIntervals('15m,1h,5m,abc')).toEqual(['15m', '1h']);
  });

  test('toTimestampMs supports Date/string/number', () => {
    expect(toTimestampMs(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(toTimestampMs('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000_000);
    expect(toTimestampMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toTimestampMs('bad')).toBeNull();
  });

  test('toFiniteNumber returns fallback on invalid', () => {
    expect(toFiniteNumber('12.5')).toBe(12.5);
    expect(toFiniteNumber('bad', 7)).toBe(7);
  });

  test('binarySearchLatestByTs returns latest <= ts', () => {
    const rows = [{ ts: 10 }, { ts: 20 }, { ts: 30 }];
    expect(binarySearchLatestByTs(rows, 5)).toBe(-1);
    expect(binarySearchLatestByTs(rows, 20)).toBe(1);
    expect(binarySearchLatestByTs(rows, 27)).toBe(1);
    expect(binarySearchLatestByTs(rows, 99)).toBe(2);
  });
});
