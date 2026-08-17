import type {
  AiPocketPrimitive,
  AiPocketSearchRow,
  AiPocketPredicate,
  AiPocketSummary,
  AiPocketSearchProgressPhase,
  AiPocketSearchProgress,
} from './contracts';
import {
  isFiniteNumber,
  type FeatureBucket,
  type ScoredPredicate,
} from './features';
import {
  formatNumber,
  formatPredicateValue,
  roundThreshold,
  quantileAt,
  createSummaryAccumulator,
  addSummaryRow,
  finalizeAiPocketSummary,
  summarizeRowIndexes,
} from './summary';

const matchesPredicate = (
  value: AiPocketPrimitive | undefined,
  predicate: AiPocketPredicate,
) => {
  if (predicate.kind === 'numeric') {
    if (!isFiniteNumber(value)) {
      return false;
    }
    return predicate.op === '<='
      ? value <= predicate.threshold
      : value >= predicate.threshold;
  }

  return value === predicate.value;
};

export const buildMask = (
  rows: AiPocketSearchRow[],
  predicate: AiPocketPredicate,
) => {
  const mask = new Uint8Array(rows.length);
  let support = 0;
  rows.forEach((row, index) => {
    if (matchesPredicate(row.features[predicate.featureKey], predicate)) {
      mask[index] = 1;
      support += 1;
    }
  });
  return { mask, support };
};

export const intersectMasks = (left: Uint8Array, right: Uint8Array) => {
  const mask = new Uint8Array(left.length);
  let support = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === 1 && right[index] === 1) {
      mask[index] = 1;
      support += 1;
    }
  }
  return { mask, support };
};

export const buildPredicateListMask = (
  rows: AiPocketSearchRow[],
  predicates: AiPocketPredicate[],
) => {
  const mask = new Uint8Array(rows.length);
  let support = 0;
  rows.forEach((row, index) => {
    if (
      predicates.every((predicate) =>
        matchesPredicate(row.features[predicate.featureKey], predicate),
      )
    ) {
      mask[index] = 1;
      support += 1;
    }
  });
  return { mask, support };
};

export const toPublicPredicate = (
  predicate: AiPocketPredicate,
): AiPocketPredicate => {
  if (predicate.kind === 'numeric') {
    return {
      id: predicate.id,
      featureKey: predicate.featureKey,
      label: predicate.label,
      kind: predicate.kind,
      op: predicate.op,
      threshold: predicate.threshold,
    };
  }

  return {
    id: predicate.id,
    featureKey: predicate.featureKey,
    label: predicate.label,
    kind: predicate.kind,
    op: predicate.op,
    value: predicate.value,
  };
};

export const buildAiPocketPredicateResult = (
  rows: AiPocketSearchRow[],
  options: {
    minSupport?: number;
    maxCategories?: number;
    progressInterval?: number;
    onProgress?: (progress: AiPocketSearchProgress) => void;
  } = {},
): { featureKeys: number; predicates: ScoredPredicate[] } => {
  const minSupport = Math.max(1, Math.trunc(options.minSupport ?? 20));
  const maxCategories = Math.max(2, Math.trunc(options.maxCategories ?? 24));
  const progressInterval = Math.max(
    1,
    Math.trunc(options.progressInterval ?? 500),
  );
  const onProgress = options.onProgress;
  const buckets = new Map<string, FeatureBucket>();
  let lastFeatureProgress = 0;
  let lastPredicateProgress = 0;

  const emitProgress = (
    phase: AiPocketSearchProgressPhase,
    current: number,
    total: number,
    done = false,
  ) => {
    if (!onProgress) {
      return;
    }
    const lastProgress =
      phase === 'features' ? lastFeatureProgress : lastPredicateProgress;
    if (!done && current - lastProgress < progressInterval) {
      return;
    }
    if (phase === 'features') {
      lastFeatureProgress = current;
    } else if (phase === 'predicates') {
      lastPredicateProgress = current;
    }
    onProgress({
      phase,
      current,
      total,
      done,
      truncated: false,
    });
  };

  rows.forEach((row, rowIndex) => {
    for (const [key, value] of Object.entries(row.features)) {
      if (value === undefined) {
        continue;
      }
      const bucket = buckets.get(key) ?? {
        key,
        count: 0,
        numericValues: [],
        numericRowIndexes: [],
        categoryCounts: new Map<
          string,
          {
            value: string | boolean | null;
            count: number;
            rowIndexes: number[];
          }
        >(),
      };
      bucket.count += 1;

      if (isFiniteNumber(value)) {
        bucket.numericValues.push(value);
        bucket.numericRowIndexes.push(rowIndex);
      }
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        value === null
      ) {
        const serialized = JSON.stringify(value);
        const categoryBucket = bucket.categoryCounts.get(serialized) ?? {
          value,
          count: 0,
          rowIndexes: [],
        };
        categoryBucket.count += 1;
        categoryBucket.rowIndexes.push(rowIndex);
        bucket.categoryCounts.set(serialized, categoryBucket);
      }

      buckets.set(key, bucket);
    }
    emitProgress('features', rowIndex + 1, rows.length);
  });
  emitProgress('features', rows.length, rows.length, true);

  const bucketList = [...buckets.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  const predicates: ScoredPredicate[] = [];

  for (let bucketIndex = 0; bucketIndex < bucketList.length; bucketIndex += 1) {
    const bucket = bucketList[bucketIndex];
    const key = bucket.key;
    if (bucket.count < minSupport) {
      emitProgress('predicates', bucketIndex + 1, bucketList.length);
      continue;
    }

    const numericEntries = bucket.numericValues
      .map((value, index) => ({
        value,
        rowIndex: bucket.numericRowIndexes[index],
      }))
      .sort((left, right) => left.value - right.value);
    const numericValues = numericEntries.map((entry) => entry.value);
    if (numericValues.length >= minSupport) {
      const uniqueValues = [...new Set(numericValues.map(roundThreshold))];
      if (uniqueValues.length > 1) {
        const thresholdSet = new Set<number>();
        [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].forEach((quantile) =>
          thresholdSet.add(roundThreshold(quantileAt(numericValues, quantile))),
        );
        if (numericValues[0] < 0 && numericValues.at(-1)! > 0) {
          thresholdSet.add(0);
        }

        const thresholds = [...thresholdSet].sort((left, right) => {
          return left - right;
        });
        const summaryByPredicate = new Map<
          string,
          { support: number; summary: AiPocketSummary }
        >();

        const lessOrEqualAccumulator = createSummaryAccumulator();
        let lessOrEqualIndex = 0;
        for (const threshold of thresholds) {
          while (
            lessOrEqualIndex < numericEntries.length &&
            numericEntries[lessOrEqualIndex].value <= threshold
          ) {
            addSummaryRow(
              lessOrEqualAccumulator,
              rows[numericEntries[lessOrEqualIndex].rowIndex],
            );
            lessOrEqualIndex += 1;
          }

          const support = lessOrEqualAccumulator.support;
          if (support >= minSupport && support < rows.length) {
            summaryByPredicate.set(`<=:${threshold}`, {
              support,
              summary: finalizeAiPocketSummary({
                rows,
                accumulator: lessOrEqualAccumulator,
              }),
            });
          }
        }

        const greaterOrEqualAccumulator = createSummaryAccumulator();
        let greaterOrEqualIndex = numericEntries.length - 1;
        for (const threshold of [...thresholds].reverse()) {
          while (
            greaterOrEqualIndex >= 0 &&
            numericEntries[greaterOrEqualIndex].value >= threshold
          ) {
            addSummaryRow(
              greaterOrEqualAccumulator,
              rows[numericEntries[greaterOrEqualIndex].rowIndex],
            );
            greaterOrEqualIndex -= 1;
          }

          const support = greaterOrEqualAccumulator.support;
          if (support >= minSupport && support < rows.length) {
            summaryByPredicate.set(`>=:${threshold}`, {
              support,
              summary: finalizeAiPocketSummary({
                rows,
                accumulator: greaterOrEqualAccumulator,
              }),
            });
          }
        }

        for (const threshold of thresholds) {
          for (const op of ['<=', '>='] as const) {
            const scored = summaryByPredicate.get(`${op}:${threshold}`);
            if (!scored) {
              continue;
            }
            predicates.push({
              id: `${key}${op}${formatNumber(threshold)}`,
              featureKey: key,
              label: `${key} ${op} ${formatNumber(threshold)}`,
              kind: 'numeric',
              op,
              threshold,
              support: scored.support,
              atomSummary: scored.summary,
            });
          }
        }
      }
      emitProgress('predicates', bucketIndex + 1, bucketList.length);
      continue;
    }

    if (
      !bucket.categoryCounts.size ||
      bucket.categoryCounts.size > maxCategories
    ) {
      emitProgress('predicates', bucketIndex + 1, bucketList.length);
      continue;
    }

    for (const { value, count, rowIndexes } of bucket.categoryCounts.values()) {
      if (count < minSupport || count >= rows.length) {
        continue;
      }
      predicates.push({
        id: `${key}==${formatPredicateValue(value)}`,
        featureKey: key,
        label: `${key} == ${formatPredicateValue(value)}`,
        kind: 'category',
        op: '==',
        value,
        support: count,
        atomSummary: summarizeRowIndexes(rows, rowIndexes),
      });
    }

    emitProgress('predicates', bucketIndex + 1, bucketList.length);
  }
  emitProgress('predicates', bucketList.length, bucketList.length, true);

  return { featureKeys: buckets.size, predicates };
};

export const buildAiPocketPredicates = (
  rows: AiPocketSearchRow[],
  options: {
    minSupport?: number;
    maxCategories?: number;
    progressInterval?: number;
    onProgress?: (progress: AiPocketSearchProgress) => void;
  } = {},
): AiPocketPredicate[] =>
  buildAiPocketPredicateResult(rows, options).predicates.map(toPublicPredicate);
