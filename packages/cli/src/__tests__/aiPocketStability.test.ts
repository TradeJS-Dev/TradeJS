import { assessDevelopmentStability } from '../lib/aiPocketSearch/stability';
import { searchAiPockets, type AiPocketSearchRow } from '../lib/aiPocketSearch';
import { runAiPocketSearchResearch } from '../lib/aiPocketSearch/research';
import { resolveAiPocketSearchCommandOptions } from '../lib/aiPocketSearch/commandOptions';

const rows = (): AiPocketSearchRow[] =>
  Array.from(
    { length: 60 },
    (_, timestamp) =>
      ({
        timestamp,
        signalId: `s${timestamp}`,
        profit: 1,
        profitableTrade: true,
        aiApproved: true,
        quality: 4,
        features: { useful: true },
        featureCoverage: { cmc: timestamp < 36, coinalyze: timestamp >= 36 },
      }) as AiPocketSearchRow,
  );

it('defaults to sealed outer 60/40, with no extra tuning partition', () => {
  const options = resolveAiPocketSearchCommandOptions({ argv: [], flags: {} });
  expect(options).toMatchObject({
    validationSplit: 0,
    testSplit: 0.4,
    sealTest: true,
  });
});

it('never lets outer-tail profit, features, or provider coverage select pockets', () => {
  const options = resolveAiPocketSearchCommandOptions({
    argv: ['-m', '5'],
    flags: {
      recent: 0,
      minSupport: 5,
      scope: 'all',
      objective: 'standalone',
      minProfitFactor: 1,
      maxBatch: 5,
      maxDepth: 1,
      coverageMode: 'auto',
      maxEventCountShare: 1,
      maxSymbolCountShare: 1,
      top: 10,
    },
  });
  const original = rows();
  const control = runAiPocketSearchResearch({ rows: original, options });
  const changed = original.map((row) =>
    row.timestamp! < 36
      ? row
      : {
          ...row,
          profit: -100000,
          profitableTrade: false,
          features: { forbidden: true },
        },
  );
  const candidate = runAiPocketSearchResearch({ rows: changed, options });
  expect(candidate.search).toEqual(control.search);
  expect(candidate.coverageSearches).toEqual(control.coverageSearches);
  expect(control.trainRows).toHaveLength(36);
  expect(control.validationRows).toHaveLength(0);
  expect(control.testRows).toHaveLength(0);
  expect(control.sealedTest).toMatchObject({ rows: 24, startTimestamp: 36 });
  expect(
    control.coverageSearches.find((v) => v.family === 'coinalyze')!.trainRows,
  ).toBe(0);
});

it('keeps insufficient support distinct from adverse temporal results', () => {
  const development = rows().map((row) => ({
    ...row,
    features: { useful: row.timestamp! % 2 === 0 },
  }));
  const make = () =>
    searchAiPockets(development, {
      minSupport: 5,
      minProfitFactor: 1,
      maxDepth: 1,
      top: 10,
    });
  const result = make();
  assessDevelopmentStability(result, {
    developmentRows: development,
    baselineRows: development,
    timestamps: development.map((r) => r.timestamp!),
    minEventsPerFold: 5,
  });
  expect(result.positivePockets[0].stability!.status).toBe('stable');
  const adverse = development.map((row) =>
    row.timestamp! < 20 ? { ...row, profit: -1 } : row,
  );
  assessDevelopmentStability(result, {
    developmentRows: adverse,
    baselineRows: adverse,
    timestamps: development.map((r) => r.timestamp!),
  });
  expect(result.positivePockets[0].stability!.status).toBe('unstable');
  const sparse = make();
  assessDevelopmentStability(sparse, {
    developmentRows: development.slice(25),
    baselineRows: [],
    timestamps: development.map((r) => r.timestamp!),
  });
  expect(sparse.positivePockets[0].stability!.status).toBe(
    'insufficient-support',
  );
});
