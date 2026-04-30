import {
  getCurrentIntervalBoundary,
  normalizeEndToIntervalBoundary,
} from '../klineWindow';

describe('klineWindow helpers', () => {
  it('normalizes minute intervals to the current candle boundary', () => {
    expect(normalizeEndToIntervalBoundary(1_001_234, '15')).toBe(900_000);
    expect(normalizeEndToIntervalBoundary(3_650_000, '60')).toBe(3_600_000);
  });

  it('normalizes larger intervals using the shared interval map', () => {
    expect(normalizeEndToIntervalBoundary(86_400_000 + 12_345, 'D')).toBe(
      86_400_000,
    );
    expect(normalizeEndToIntervalBoundary(604_800_000 + 99_999, 'W')).toBe(
      604_800_000,
    );
  });

  it('uses Date.now for the current interval boundary', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_001_234);

    expect(getCurrentIntervalBoundary('15')).toBe(900_000);

    nowSpy.mockRestore();
  });
});
