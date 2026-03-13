import { findLookaheadViolations, isTimestampFeatureKey } from '@tradejs/infra';

describe('mlCausalityGuard', () => {
  it('detects timestamp-like keys only by expected suffixes', () => {
    expect(isTimestampFeatureKey('touchTs')).toBe(true);
    expect(isTimestampFeatureKey('touchTimestamp')).toBe(true);
    expect(isTimestampFeatureKey('touchAtMs')).toBe(true);
    expect(isTimestampFeatureKey('POINTS_TS_1')).toBe(false);
    expect(isTimestampFeatureKey('entryTimestamp')).toBe(false);
  });

  it('returns no violations when all feature timestamps are <= entryTimestamp', () => {
    const row = {
      entryTimestamp: 1_770_000_000_000,
      touchTs: 1_769_999_000_000,
      candleTimestamp: 1_770_000_000_000,
      label: 1,
    };
    expect(findLookaheadViolations(row)).toEqual([]);
  });

  it('detects lookahead for milliseconds timestamps', () => {
    const row = {
      entryTimestamp: 1_770_000_000_000,
      touchTs: 1_770_000_000_001,
    };
    const violations = findLookaheadViolations(row);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      key: 'touchTs',
      entryTimestampMs: 1_770_000_000_000,
      featureTimestampMs: 1_770_000_000_001,
    });
  });

  it('detects lookahead for seconds timestamps after normalization', () => {
    const row = {
      entryTimestamp: 1_770_000_000,
      touchTimestamp: 1_770_000_001,
    };
    const violations = findLookaheadViolations(row);
    expect(violations).toHaveLength(1);
    expect(violations[0].entryTimestampMs).toBe(1_770_000_000_000);
    expect(violations[0].featureTimestampMs).toBe(1_770_000_001_000);
  });

  it('ignores non-numeric timestamp-like values', () => {
    const row = {
      entryTimestamp: 1_770_000_000_000,
      touchTs: 'n/a',
    };
    expect(findLookaheadViolations(row)).toEqual([]);
  });
});
