const DAY_MS = 24 * 60 * 60 * 1000;

export const toIsoUtcOrNull = (
  value: number | null | undefined,
): string | null => {
  if (!Number.isFinite(value) || !value || value <= 0) return null;
  return new Date(Number(value)).toISOString();
};

export const isDerivedDatasetFileName = (name: string): boolean =>
  [
    '.holdout-train.',
    '.holdout-test.',
    '.walk-forward.',
    '.walk-forward-',
    '.prod.',
  ].some((token) => name.includes(token));

export const computeWindowBoundaries = ({
  maxLabeledTs,
  maxTrainTs,
  testDays,
  trainRecentDays,
  walkForwardFolds,
}: {
  maxLabeledTs: number;
  maxTrainTs: number;
  testDays: number;
  trainRecentDays: number;
  walkForwardFolds: number;
}) => {
  const holdoutCutoffMs = maxLabeledTs - testDays * DAY_MS;
  const holdoutTrainStartMs =
    trainRecentDays > 0
      ? maxTrainTs - trainRecentDays * DAY_MS
      : Number.NEGATIVE_INFINITY;
  const wfStartMs =
    trainRecentDays > 0
      ? maxTrainTs -
        (trainRecentDays + Math.max(walkForwardFolds, 0) * testDays) * DAY_MS
      : Number.NEGATIVE_INFINITY;
  const prodStartMs =
    trainRecentDays > 0
      ? maxLabeledTs - trainRecentDays * DAY_MS
      : Number.NEGATIVE_INFINITY;
  const folds = Array.from(
    { length: Math.max(walkForwardFolds, 0) },
    (_, i) => {
      const fold = i + 1;
      const endTs = maxTrainTs - (fold - 1) * testDays * DAY_MS;
      const startTs = endTs - testDays * DAY_MS;
      return { fold, startTs, endTs };
    },
  );

  return {
    holdoutCutoffMs,
    holdoutTrainStartMs,
    wfStartMs,
    prodStartMs,
    folds,
  };
};
