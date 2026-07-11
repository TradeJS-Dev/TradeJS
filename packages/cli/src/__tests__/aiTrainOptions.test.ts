import {
  hasCliOption,
  parseDumpFeatureMode,
  parseQualityThresholds,
  parseTerminalWindowDays,
  parseTimestampFilter,
  parseTrailingPeriodMs,
  resolveAiTrainRecentLimit,
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

  it('parses terminal research windows in descending order', () => {
    expect(parseTerminalWindowDays(undefined)).toEqual([90, 30, 7]);
    expect(parseTerminalWindowDays('7,30,11,7,0,x')).toEqual([30, 11, 7]);
    expect(parseTerminalWindowDays('')).toEqual([]);
  });

  it('parses dump feature snapshot modes', () => {
    expect(parseDumpFeatureMode(undefined)).toBe('none');
    expect(parseDumpFeatureMode('')).toBe('none');
    expect(parseDumpFeatureMode('none')).toBe('none');
    expect(parseDumpFeatureMode('gateFeatures')).toBe('gateFeatures');
    expect(parseDumpFeatureMode('gate-features')).toBe('gateFeatures');
    expect(parseDumpFeatureMode('baseContext')).toBe('baseContext');
    expect(parseDumpFeatureMode('base-context')).toBe('baseContext');
  });

  it('rejects invalid dump feature snapshot modes', () => {
    expect(() => parseDumpFeatureMode('full')).toThrow(
      /Invalid --dumpFeatures value/,
    );
  });

  it('detects explicit CLI options without matching other flags', () => {
    expect(
      hasCliOption({
        argv: ['node', 'aiTrain', '--period', 'last365d', '-n', '0'],
        longName: 'recent',
        shortName: 'n',
      }),
    ).toBe(true);
    expect(
      hasCliOption({
        argv: ['node', 'aiTrain', '--minQuality=4', '--period=last365d'],
        longName: 'recent',
        shortName: 'n',
      }),
    ).toBe(false);
    expect(
      hasCliOption({
        argv: ['node', 'aiTrain', '--recent=500'],
        longName: 'recent',
        shortName: 'n',
      }),
    ).toBe(true);
  });

  it('uses all rows for date filters unless recent is explicit', () => {
    expect(
      resolveAiTrainRecentLimit({
        argv: ['node', 'aiTrain', '--period', 'last365d'],
        recentValue: 50,
        hasDateFilter: true,
      }),
    ).toBe(0);
    expect(
      resolveAiTrainRecentLimit({
        argv: ['node', 'aiTrain', '--period', 'last365d', '-n', '500'],
        recentValue: 500,
        hasDateFilter: true,
      }),
    ).toBe(500);
    expect(
      resolveAiTrainRecentLimit({
        argv: ['node', 'aiTrain'],
        recentValue: 50,
        hasDateFilter: false,
      }),
    ).toBe(50);
  });
});
