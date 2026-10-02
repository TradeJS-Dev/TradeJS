import type {
  JevDimension,
  JevFeature,
  JevGateModel,
  JevScores,
  JevStudyRow,
  JevTree,
} from '@tradejs/types';
import {
  JEV_DIMENSIONS,
  JEV_QUESTION_SET,
  decideJev,
  predictJevTree,
} from '@tradejs/core/jev';
import {
  jevScoreMaximum,
  jevHash,
  validateJevResponse,
} from '@tradejs/infra/jev';
import { JEV_QUESTIONS, questionsForJevInput } from './jevInput';

const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const variance = (values: number[]) => {
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0);
};

export const validateJevStudy = (rows: JevStudyRow[]) => {
  const unique = new Map<string, JevStudyRow>();
  if (rows.length > 20_000)
    throw new Error(
      'Jev training is bounded to 20000 rows; select a frozen sample first',
    );
  for (const row of rows) {
    const record = row?.record;
    if (
      row?.schema !== 'tradejs-jev-study/v4' ||
      !row.signalId ||
      record?.schema !== 'tradejs-jev-record/v4' ||
      record.input?.schema !== 'tradejs-jev-input/v4' ||
      record.input.questionSet !== JEV_QUESTION_SET ||
      !Number.isFinite(record.input.timestamp) ||
      record.inputHash !== jevHash(record.input) ||
      record.questionsHash !== jevHash(questionsForJevInput(record.input)) ||
      record.id !==
        jevHash({
          inputHash: record.inputHash,
          questionsHash: record.questionsHash,
          provider: record.provider,
        })
    )
      throw new Error('Invalid Jev study provenance');
    validateJevResponse(record.response, record.input.questions);
    for (const dimension of JEV_DIMENSIONS) {
      const expected = record.input.questions.includes(dimension)
        ? record.response.answers[dimension]!.score / jevScoreMaximum(dimension)
        : null;
      if (record.scores[dimension] !== expected)
        throw new Error('Jev study scores do not match the teacher response');
    }
    if (row.profit != null && !Number.isFinite(row.profit))
      throw new Error('Invalid study outcome');
    const prior = unique.get(record.inputHash);
    if (
      prior &&
      (prior.record.id !== record.id ||
        prior.profit !== row.profit ||
        jevHash(prior.record.response) !== jevHash(record.response))
    )
      throw new Error('Conflicting duplicated Jev sample');
    unique.set(record.inputHash, row);
  }
  const ordered = [...unique.values()].sort(
    (a, b) =>
      a.record.input.timestamp - b.record.input.timestamp ||
      a.record.id.localeCompare(b.record.id),
  );
  if (!ordered.length) throw new Error('Empty Jev study');
  const first = ordered[0].record;
  if (
    ordered.some(
      (row) =>
        row.record.input.strategy !== first.input.strategy ||
        row.record.response.model !== first.response.model ||
        jevHash(row.record.provider) !== jevHash(first.provider),
    )
  )
    throw new Error(
      'Train one strategy and one frozen teacher/provider lineage at a time',
    );
  return ordered;
};

const trainTree = (
  rows: JevStudyRow[],
  dimension: JevDimension,
  depth: number,
  minLeaf: number,
): JevTree => {
  const values = rows.map((row) => row.record.scores[dimension]!);
  const leaf: JevTree = { value: mean(values), samples: rows.length };
  if (depth === 0 || rows.length < minLeaf * 2 || variance(values) < 1e-8)
    return leaf;
  const keys = [
    ...new Set(rows.flatMap((row) => Object.keys(row.record.input.features))),
  ]
    .sort()
    .filter(
      (key) =>
        new Set(rows.map((row) => row.record.input.features[key])).size > 1,
    );
  // Stable bounded candidate selection; no outcomes or teacher scores enter features.
  if (keys.length > 2000) throw new Error('Too many Jev student features');
  let best:
    | {
        feature: string;
        operator: 'lte' | 'eq';
        value: JevFeature;
        missingLeft: boolean;
        left: JevStudyRow[];
        right: JevStudyRow[];
      }
    | undefined;
  let bestLoss = variance(values);
  for (const feature of keys) {
    const observed = [
      ...new Set(
        rows
          .map((row) => row.record.input.features[feature])
          .filter((value) => value != null),
      ),
    ];
    const numeric = observed.every((value) => typeof value === 'number');
    const sorted = numeric
      ? (observed as number[]).sort((a, b) => a - b)
      : observed.sort((a, b) => String(a).localeCompare(String(b)));
    const candidates = sorted
      .filter(
        (_, index) => index % Math.max(1, Math.ceil(sorted.length / 12)) === 0,
      )
      .slice(0, 12);
    for (const value of candidates)
      for (const missingLeft of [true, false]) {
        const left: JevStudyRow[] = [],
          right: JevStudyRow[] = [];
        for (const row of rows) {
          const input = row.record.input.features[feature];
          const goesLeft =
            input == null
              ? missingLeft
              : numeric
                ? typeof input === 'number' && input <= (value as number)
                : input === value;
          (goesLeft ? left : right).push(row);
        }
        if (left.length < minLeaf || right.length < minLeaf) continue;
        const loss =
          variance(left.map((row) => row.record.scores[dimension]!)) +
          variance(right.map((row) => row.record.scores[dimension]!));
        if (loss < bestLoss - 1e-8) {
          bestLoss = loss;
          best = {
            feature,
            operator: numeric ? 'lte' : 'eq',
            value,
            missingLeft,
            left,
            right,
          };
        }
      }
  }
  if (!best) return leaf;
  return {
    feature: best.feature,
    operator: best.operator,
    value: best.value,
    missingLeft: best.missingLeft,
    left: trainTree(best.left, dimension, depth - 1, minLeaf),
    right: trainTree(best.right, dimension, depth - 1, minLeaf),
  };
};

export const validateJevGateModel = (value: unknown): JevGateModel => {
  const model = value as JevGateModel;
  if (
    model?.schema !== 'tradejs-jev-gate/v2' ||
    model.inputSchema !== 'tradejs-jev-input/v4' ||
    typeof model.strategy !== 'string' ||
    !model.strategy ||
    !model.teacherModel ||
    !model.trees ||
    model.questionSet !== JEV_QUESTION_SET ||
    JEV_DIMENSIONS.some((dimension) => !(dimension in model.trees)) ||
    Object.keys(model.trees).some(
      (dimension) => !JEV_DIMENSIONS.includes(dimension as JevDimension),
    ) ||
    model.questionsHash !== jevHash(JEV_QUESTIONS) ||
    !model.training ||
    !/^[a-f0-9]{64}$/.test(model.training.datasetHash)
  )
    throw new Error('Invalid local Jev gate');
  const { trainEnd, validationEnd, testEnd } = model.training;
  if (
    ![trainEnd, validationEnd, testEnd].every(Number.isFinite) ||
    model.training.split !== 'outer-60-40' ||
    !(trainEnd === validationEnd && trainEnd < testEnd)
  )
    throw new Error('Invalid local Jev gate partitions');
  const check = (tree: JevTree, depth: number) => {
    if (!tree || depth > 8) throw new Error('Invalid local Jev tree');
    if ('samples' in tree) {
      if (
        !Number.isFinite(tree.value) ||
        tree.value < 0 ||
        tree.value > 1 ||
        !Number.isInteger(tree.samples) ||
        tree.samples < 1
      )
        throw new Error('Invalid local Jev leaf');
      return;
    }
    if (
      typeof tree.feature !== 'string' ||
      !['lte', 'eq'].includes(tree.operator) ||
      typeof tree.missingLeft !== 'boolean' ||
      (tree.operator === 'lte' && !Number.isFinite(tree.value)) ||
      !['number', 'boolean', 'string'].includes(typeof tree.value)
    )
      throw new Error('Invalid local Jev split');
    check(tree.left, depth + 1);
    check(tree.right, depth + 1);
  };
  for (const dimension of JEV_DIMENSIONS) {
    if (model.trees[dimension] != null) check(model.trees[dimension]!, 0);
  }
  return model;
};

const predict = (model: JevGateModel, row: JevStudyRow): JevScores =>
  Object.fromEntries(
    JEV_DIMENSIONS.map((key) => [
      key,
      model.trees[key] && row.record.input.questions.includes(key)
        ? predictJevTree(model.trees[key]!, row.record.input.features)
        : null,
    ]),
  ) as JevScores;

const economics = (rows: JevStudyRow[]) => {
  const known = rows.filter((row) => row.profit != null);
  const profits = known.map((row) => row.profit!);
  const wins = profits
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const losses = -profits
    .filter((value) => value < 0)
    .reduce((sum, value) => sum + value, 0);
  return {
    rows: rows.length,
    knownOutcomes: known.length,
    pnl: profits.reduce((a, b) => a + b, 0),
    pnlPerTrade: profits.length ? mean(profits) : null,
    profitFactor: losses ? wins / losses : null,
    winRate: profits.length
      ? profits.filter((value) => value > 0).length / profits.length
      : null,
  };
};

export const compareJevGate = (
  model: JevGateModel,
  input: JevStudyRow[],
  minScores: Partial<Record<JevDimension, number>> = {},
) => {
  validateJevGateModel(model);
  const rows = validateJevStudy(input);
  if (
    rows.some(
      (row) =>
        row.record.input.strategy !== model.strategy ||
        row.record.response.model !== model.teacherModel,
    )
  )
    throw new Error('Model and study lineage do not match');
  const decisions = rows.map((row) => {
    const policy = {
      source: 'local' as const,
      mode: 'gate' as const,
      minScores,
    };
    const scores = predict(model, row);
    const student = decideJev(
      scores,
      policy,
      row.record.input.geometryStatus,
      row.record.input.features,
      row.record.input.questions,
    ).allowed;
    const teacher = decideJev(
      row.record.scores,
      policy,
      row.record.input.geometryStatus,
      row.record.input.features,
      row.record.input.questions,
    ).allowed;
    return { row, scores, student, teacher };
  });
  const dimensionErrors = Object.fromEntries(
    JEV_DIMENSIONS.map((key) => {
      const pairs = decisions.filter(
        (item) =>
          item.row.record.scores[key] != null && item.scores[key] != null,
      );
      return [
        key,
        {
          n: pairs.length,
          mae: pairs.length
            ? mean(
                pairs.map((item) =>
                  Math.abs(item.scores[key]! - item.row.record.scores[key]!),
                ),
              )
            : null,
        },
      ];
    }),
  );
  const selected = (
    predicate: (value: (typeof decisions)[number]) => boolean,
  ) => decisions.filter(predicate).map((value) => value.row);
  return {
    rows: rows.length,
    start: rows[0].record.input.timestamp,
    end: rows[rows.length - 1].record.input.timestamp,
    agreement:
      decisions.filter((item) => item.student === item.teacher).length /
      rows.length,
    teacherOnly: decisions.filter((item) => item.teacher && !item.student)
      .length,
    studentOnly: decisions.filter((item) => item.student && !item.teacher)
      .length,
    dimensionErrors,
    outcomeScope:
      'Matched completed outcomes only; this is not a sequential portfolio backtest. Unexecuted candidates have no observed outcome.',
    cohorts: Object.fromEntries(
      ['ALL', 'LONG', 'SHORT'].map((side) => [
        side,
        {
          core: economics(
            selected(
              (item) =>
                side === 'ALL' || item.row.record.input.direction === side,
            ),
          ),
          baseline: economics(
            selected(
              (item) =>
                item.row.baselineAllowed === true &&
                (side === 'ALL' || item.row.record.input.direction === side),
            ),
          ),
          jev: economics(
            selected(
              (item) =>
                item.teacher &&
                (side === 'ALL' || item.row.record.input.direction === side),
            ),
          ),
          local: economics(
            selected(
              (item) =>
                item.student &&
                (side === 'ALL' || item.row.record.input.direction === side),
            ),
          ),
        },
      ]),
    ),
  };
};

export const trainJevGate = (
  input: JevStudyRow[],
  options: { maxDepth?: number; minLeaf?: number } = {},
) => {
  const rows = validateJevStudy(input);
  const maxDepth = options.maxDepth ?? 3,
    minLeaf = options.minLeaf ?? 10;
  if (
    !Number.isInteger(maxDepth) ||
    maxDepth < 1 ||
    maxDepth > 6 ||
    !Number.isInteger(minLeaf) ||
    minLeaf < 2
  )
    throw new Error('Invalid Jev training limits');
  const timestamps = [
    ...new Set(rows.map((row) => row.record.input.timestamp)),
  ];
  if (rows.length < 30 || timestamps.length < 10)
    throw new Error('Need at least 30 distinct samples across 10 signal times');
  const trainEnd =
    timestamps[
      timestamps.length - Math.max(1, Math.floor(timestamps.length * 0.4)) - 1
    ];
  // Retain the legacy metadata key, but no separate tuning/test boundary.
  const validationEnd = trainEnd;
  const train = rows.filter((row) => row.record.input.timestamp <= trainEnd);
  const test = rows.filter((row) => row.record.input.timestamp > trainEnd);
  const fit = (samples: JevStudyRow[]) =>
    Object.fromEntries(
      JEV_DIMENSIONS.map((key) => {
        const eligible = samples.filter(
          (row) => row.record.scores[key] != null,
        );
        return [
          key,
          eligible.length ? trainTree(eligible, key, maxDepth, minLeaf) : null,
        ];
      }),
    ) as JevGateModel['trees'];
  const first = rows[0].record;
  const model: JevGateModel = {
    schema: 'tradejs-jev-gate/v2',
    inputSchema: 'tradejs-jev-input/v4',
    strategy: first.input.strategy,
    questionSet: JEV_QUESTION_SET,
    questionsHash: jevHash(JEV_QUESTIONS),
    teacherModel: first.response.model,
    trees: fit(train),
    training: {
      split: 'outer-60-40',
      datasetHash: jevHash(
        rows.map((row) => ({
          id: row.record.id,
          response: row.record.response,
        })),
      ),
      trainEnd,
      validationEnd,
      testEnd: timestamps[timestamps.length - 1],
      maxDepth,
      minLeaf,
    },
  };
  validateJevGateModel(model);
  // Independently fitted expanding windows wholly inside the first 60%.
  const developmentTimes = timestamps.filter(
    (timestamp) => timestamp <= trainEnd,
  );
  const walkForward = [0.25, 0.5, 0.75].map((fraction) => {
    const trainThrough =
      developmentTimes[
        Math.max(0, Math.floor(developmentTimes.length * fraction) - 1)
      ];
    const testThrough =
      developmentTimes[
        Math.min(
          developmentTimes.length - 1,
          Math.floor(developmentTimes.length * (fraction + 0.25)) - 1,
        )
      ];
    const fitting = train.filter(
      (row) => row.record.input.timestamp <= trainThrough,
    );
    const evaluation = train.filter(
      (row) =>
        row.record.input.timestamp > trainThrough &&
        row.record.input.timestamp <= testThrough,
    );
    const fold: JevGateModel = {
      ...model,
      trees: fit(fitting),
      training: {
        ...model.training,
        trainEnd: trainThrough,
        validationEnd: trainThrough,
        testEnd: testThrough,
      },
    };
    return {
      trainThrough,
      validationThrough: trainThrough,
      testThrough,
      trainRows: fitting.length,
      test: compareJevGate(fold, evaluation),
    };
  });
  return {
    model,
    report: {
      train: compareJevGate(model, train),
      partitionScheme: 'outer-60-40',
      stabilityRole: 'independently fitted folds inside development only',
      test: compareJevGate(model, test),
      walkForward,
      promotion:
        'research-only; validate a sequential backtest and prospective signals before runtime admission',
    },
  };
};
