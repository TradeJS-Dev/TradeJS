import {
  computeWindowBoundaries,
  isDerivedDatasetFileName,
  toIsoUtcOrNull,
} from '../mlWindowing';

describe('mlWindowing', () => {
  it('computes holdout/walk-forward/prod windows for recent-days mode', () => {
    const res = computeWindowBoundaries({
      maxLabeledTs: 1_771_163_100_000,
      maxTrainTs: 1_768_570_200_000,
      testDays: 30,
      trainRecentDays: 60,
      walkForwardFolds: 2,
    });

    expect(res.holdoutCutoffMs).toBe(1_768_571_100_000);
    expect(res.holdoutTrainStartMs).toBe(1_763_386_200_000);
    expect(res.wfStartMs).toBe(1_758_202_200_000);
    expect(res.prodStartMs).toBe(1_765_979_100_000);
    expect(res.folds).toEqual([
      { fold: 1, startTs: 1_765_978_200_000, endTs: 1_768_570_200_000 },
      { fold: 2, startTs: 1_763_386_200_000, endTs: 1_765_978_200_000 },
    ]);
  });

  it('returns no folds when walkForwardFolds is 0', () => {
    const res = computeWindowBoundaries({
      maxLabeledTs: 1_000_000_000_000,
      maxTrainTs: 900_000_000_000,
      testDays: 30,
      trainRecentDays: 60,
      walkForwardFolds: 0,
    });

    expect(res.folds).toHaveLength(0);
  });

  it('disables recent-day boundaries when trainRecentDays is 0', () => {
    const res = computeWindowBoundaries({
      maxLabeledTs: 1_000_000_000_000,
      maxTrainTs: 900_000_000_000,
      testDays: 30,
      trainRecentDays: 0,
      walkForwardFolds: 2,
    });

    expect(Number.isFinite(res.holdoutTrainStartMs)).toBe(false);
    expect(Number.isFinite(res.wfStartMs)).toBe(false);
    expect(Number.isFinite(res.prodStartMs)).toBe(false);
    expect(res.folds).toHaveLength(2);
  });

  it('recognizes derived dataset filenames', () => {
    expect(
      isDerivedDatasetFileName('ml-dataset-a.holdout-train.abc.jsonl'),
    ).toBe(true);
    expect(
      isDerivedDatasetFileName('ml-dataset-a.holdout-test.abc.jsonl'),
    ).toBe(true);
    expect(
      isDerivedDatasetFileName(
        'ml-dataset-a.walk-forward-fold-1.test.abc.jsonl',
      ),
    ).toBe(true);
    expect(isDerivedDatasetFileName('ml-dataset-a.prod.abc.jsonl')).toBe(true);
    expect(isDerivedDatasetFileName('ml-dataset-a-merged-123.jsonl')).toBe(
      false,
    );
  });

  it('formats timestamps to ISO and handles null-ish values', () => {
    expect(toIsoUtcOrNull(1_771_163_100_000)).toBe('2026-02-15T13:45:00.000Z');
    expect(toIsoUtcOrNull(0)).toBeNull();
    expect(toIsoUtcOrNull(null)).toBeNull();
    expect(toIsoUtcOrNull(undefined)).toBeNull();
    expect(toIsoUtcOrNull(Number.NaN)).toBeNull();
  });
});
