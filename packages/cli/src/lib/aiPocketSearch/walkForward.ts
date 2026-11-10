import { TICKER_PROFILE_AI_FEATURES } from '@tradejs/core/aiFeatures';
import { classifyAiPocketLabelHorizon } from '../aiPocketSearchCli';
import type { AiPocketPredicate, AiPocketSearchRow } from './contracts';
import type { AiPocketSearchCommandOptions } from './commandOptions';
import { buildPredicateListMask } from './predicates';
import { runAiPocketSearchResearch } from './research';
import { summarizeRowIndexes } from './summary';

type Fold = { trainStart: number; testStart: number; testEnd: number };
type Plan = {
  folds: Fold[];
  baselineFeatures: string[];
  tickerGroups: string[];
  minimumEvents: number;
  sensitivityFraction?: number;
};

const groupPaths = new Set(
  TICKER_PROFILE_AI_FEATURES.filter(
    (feature) => feature.unit === 'category' && feature.role === 'input',
  ).map((feature) => `registered.${feature.id}`),
);

export function validateGateWalkForwardPlan(
  input: unknown,
  outerTestStart: number,
): Plan {
  const plan = input as Plan;
  if (
    !plan ||
    !Array.isArray(plan.folds) ||
    !plan.folds.length ||
    !Array.isArray(plan.baselineFeatures) ||
    !plan.baselineFeatures.length ||
    !plan.baselineFeatures.every(
      (key) => typeof key === 'string' && key.trim() && !groupPaths.has(key),
    ) ||
    !Array.isArray(plan.tickerGroups) ||
    !plan.tickerGroups.length ||
    !plan.tickerGroups.every((key) => groupPaths.has(key)) ||
    !Number.isSafeInteger(plan.minimumEvents) ||
    plan.minimumEvents < 1 ||
    (plan.sensitivityFraction !== undefined &&
      (!Number.isFinite(plan.sensitivityFraction) ||
        plan.sensitivityFraction <= 0 ||
        plan.sensitivityFraction > 1))
  ) {
    throw new Error(
      'Invalid gate walk-forward plan: specify folds, old feature paths, registered ticker groups and minimum event support',
    );
  }
  let previousEnd = -Infinity;
  for (const fold of plan.folds) {
    if (
      !fold ||
      ![fold.trainStart, fold.testStart, fold.testEnd].every(
        Number.isSafeInteger,
      ) ||
      fold.trainStart >= fold.testStart ||
      fold.testStart >= fold.testEnd ||
      fold.testStart < previousEnd ||
      fold.testEnd > outerTestStart
    ) {
      throw new Error(
        'Gate walk-forward requires ordered, disjoint test windows inside development',
      );
    }
    previousEnd = fold.testEnd;
  }
  return plan;
}

const eventCount = (rows: AiPocketSearchRow[]) =>
  new Set(rows.map((row) => row.timestamp)).size;

const select = (
  rows: AiPocketSearchRow[],
  predicates: AiPocketPredicate[] | undefined,
  objective: AiPocketSearchCommandOptions['objective'],
) => {
  if (!predicates) return rows.map((row) => row.aiApproved);
  const { mask } = buildPredicateListMask(rows, predicates);
  return rows.map((row, index) => {
    if (objective === 'add-to-gate') return row.aiApproved || mask[index] === 1;
    if (objective === 'filter-gate') return row.aiApproved && mask[index] === 1;
    return mask[index] === 1;
  });
};

const summarize = (rows: AiPocketSearchRow[], mask: boolean[]) =>
  summarizeRowIndexes(
    rows,
    rows.flatMap((_, index) => (mask[index] ? [index] : [])),
  );

const compare = (rows: AiPocketSearchRow[], a: boolean[], b: boolean[]) => ({
  common: summarize(
    rows,
    b.map((allow, index) => allow && a[index]),
  ),
  added: summarize(
    rows,
    b.map((allow, index) => allow && !a[index]),
  ),
  removed: summarize(
    rows,
    a.map((allow, index) => allow && !b[index]),
  ),
});

export function runGateWalkForward(
  rows: AiPocketSearchRow[],
  plan: Plan,
  options: AiPocketSearchCommandOptions,
) {
  if (
    !options.sealTest ||
    options.testSince == null ||
    options.scope !== 'all'
  ) {
    throw new Error(
      'Gate walk-forward requires --sealTest, an explicit --testSince and --scope all',
    );
  }
  validateGateWalkForwardPlan(plan, options.testSince);
  const earlierRows = rows.filter(
    (row) =>
      row.timestamp != null &&
      row.timestamp < options.testSince! &&
      (!options.direction || row.direction === options.direction),
  );
  const features = {
    B: new Set(plan.baselineFeatures),
    C: new Set([...plan.baselineFeatures, ...plan.tickerGroups]),
  };
  const admitted: Record<'A' | 'B' | 'C', boolean[]> = { A: [], B: [], C: [] };
  const evaluated: AiPocketSearchRow[] = [];
  const folds = plan.folds.map((fold) => {
    const inTrain = earlierRows.filter(
      (row) =>
        row.timestamp! >= fold.trainStart && row.timestamp! < fold.testStart,
    );
    const train = inTrain.filter(
      (row) =>
        !classifyAiPocketLabelHorizon(
          row.timestamp!,
          row.exitTimestamp,
          fold.testStart,
        ),
    );
    const inTest = earlierRows.filter(
      (row) =>
        row.timestamp! >= fold.testStart && row.timestamp! < fold.testEnd,
    );
    const test = inTest.filter(
      (row) =>
        !classifyAiPocketLabelHorizon(
          row.timestamp!,
          row.exitTimestamp,
          fold.testEnd,
        ),
    );
    const groupOverlap = Object.fromEntries(
      plan.tickerGroups.map((key) => {
        const known = (row: AiPocketSearchRow) =>
          typeof row.features[key] === 'string' &&
          row.features[key] !== 'unknown';
        const knownTrain = train.filter(known);
        const knownTest = test.filter(known);
        const trainValues = new Set(knownTrain.map((row) => row.features[key]));
        const testValues = new Set(knownTest.map((row) => row.features[key]));
        return [
          key,
          {
            trainEvents: eventCount(knownTrain),
            testEvents: eventCount(knownTest),
            trainOverlapEvents: eventCount(
              knownTrain.filter((row) => testValues.has(row.features[key])),
            ),
            testOverlapEvents: eventCount(
              knownTest.filter((row) => trainValues.has(row.features[key])),
            ),
          },
        ];
      }),
    );
    const support = {
      trainEvents: eventCount(train),
      testEvents: eventCount(test),
      purgedTrainRows: inTrain.length - train.length,
      purgedTestRows: inTest.length - test.length,
      groupOverlap,
    };
    if (
      Math.min(support.trainEvents, support.testEvents) < plan.minimumEvents ||
      !plan.tickerGroups.some(
        (group) =>
          support.groupOverlap[group].trainOverlapEvents >=
            plan.minimumEvents &&
          support.groupOverlap[group].testOverlapEvents >= plan.minimumEvents,
      )
    ) {
      return { ...fold, support, status: 'insufficient-support' as const };
    }
    const discover = (allowed: Set<string>) => {
      const result = runAiPocketSearchResearch({
        rows: train.map((row) => ({
          ...row,
          features: Object.fromEntries(
            Object.entries(row.features).filter(([key]) => allowed.has(key)),
          ),
        })),
        options: {
          ...options,
          testSince: null,
          validationSplit: 0,
          testSplit: 0,
          sealTest: false,
          coverageMode: 'full',
        },
      }).search;
      const selected = result.positivePockets.find(
        (pocket) => pocket.stability?.status === 'stable',
      );
      return {
        predicates: selected?.predicates,
        combinations: result.stats.combinationsEvaluated,
        fallback: selected ? null : 'current-gate',
      };
    };
    const B = discover(features.B);
    const C = discover(features.C);
    const masks = {
      A: select(test, undefined, options.objective),
      B: select(test, B.predicates, options.objective),
      C: select(test, C.predicates, options.objective),
    };
    for (const row of test) evaluated.push(row);
    for (const key of ['A', 'B', 'C'] as const)
      for (const allow of masks[key]) admitted[key].push(allow);
    const sensitivity = (predicates?: AiPocketPredicate[]) =>
      predicates?.flatMap((predicate, index) =>
        predicate.kind === 'numeric' &&
        predicate.threshold !== 0 &&
        plan.sensitivityFraction
          ? [-1, 1].map((sign) => {
              const threshold =
                predicate.threshold +
                sign *
                  Math.abs(predicate.threshold) *
                  plan.sensitivityFraction!;
              const adjusted = predicates.map((p, i) =>
                i === index ? { ...predicate, threshold } : p,
              );
              return {
                feature: predicate.featureKey,
                threshold,
                summary: summarize(
                  test,
                  select(test, adjusted, options.objective),
                ),
              };
            })
          : [],
      ) ?? [];
    return {
      ...fold,
      support,
      status: 'evaluated' as const,
      B,
      C,
      metrics: {
        A: summarize(test, masks.A),
        B: summarize(test, masks.B),
        C: summarize(test, masks.C),
      },
      sensitivity: {
        B: sensitivity(B.predicates),
        C: sensitivity(C.predicates),
      },
    };
  });
  const evaluationDays = folds.reduce(
    (sum, fold) =>
      fold.status === 'evaluated'
        ? sum + (fold.testEnd - fold.testStart) / 86_400_000
        : sum,
    0,
  );
  return {
    schema: 'tradejs-gate-walk-forward/v1',
    basis:
      'Completed labels grouped by decision time. Retrospective diagnostic; no portfolio execution.',
    outerTestStart: options.testSince,
    plan,
    folds,
    status: folds.every((fold) => fold.status === 'evaluated')
      ? 'evaluated'
      : 'insufficient-support',
    evaluatedEvents: eventCount(evaluated),
    evaluationDays,
    metrics: Object.fromEntries(
      Object.entries(admitted).map(([key, mask]) => [
        key,
        {
          ...summarize(evaluated, mask),
          admissionsPerEvaluationDay:
            evaluationDays > 0
              ? mask.filter(Boolean).length / evaluationDays
              : null,
        },
      ]),
    ),
    comparisons: {
      retraining: compare(evaluated, admitted.A, admitted.B),
      tickerGroups: compare(evaluated, admitted.B, admitted.C),
      replacement: compare(evaluated, admitted.A, admitted.C),
    },
  };
}
