import {
  parseQualityThresholds,
  parseTimestampFilter,
  parseTrailingPeriodMs,
} from '../lib/aiTrainOptions';

describe('aiTrainOptions', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('parses empty, epoch, and ISO timestamp filters', () => {
    expect(parseTimestampFilter('')).toBeNull();
    expect(parseTimestampFilter(undefined)).toBeNull();
    expect(parseTimestampFilter('1780484400000')).toBe(1780484400000);
    expect(parseTimestampFilter('2026-06-03T20:00:00.000Z')).toBe(
      1780516800000,
    );
  });

  it('rejects invalid timestamp filters', () => {
    expect(() => parseTimestampFilter('not-a-date')).toThrow(
      /Invalid timestamp filter/,
    );
  });

  it('parses trailing periods', () => {
    expect(parseTrailingPeriodMs('')).toBeNull();
    expect(parseTrailingPeriodMs('last365d')).toBe(365 * DAY_MS);
    expect(parseTrailingPeriodMs('90d')).toBe(90 * DAY_MS);
    expect(parseTrailingPeriodMs('12w')).toBe(12 * 7 * DAY_MS);
    expect(parseTrailingPeriodMs('1y')).toBe(365 * DAY_MS);
    expect(parseTrailingPeriodMs('1month')).toBe(30.4375 * DAY_MS);
  });

  it('rejects invalid trailing periods', () => {
    expect(() => parseTrailingPeriodMs('recent')).toThrow(
      /Invalid --period value/,
    );
  });

  it('deduplicates and sorts quality thresholds', () => {
    expect(parseQualityThresholds('5,3,4,4,0,-1,x,2.9')).toEqual([2, 3, 4, 5]);
    expect(parseQualityThresholds(undefined)).toEqual([3, 4, 5]);
  });
});
