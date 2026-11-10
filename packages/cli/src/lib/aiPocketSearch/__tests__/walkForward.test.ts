import { resolveAiPocketSearchCommandOptions } from '../commandOptions';
import {
  runGateWalkForward,
  validateGateWalkForwardPlan,
} from '../walkForward';
import type { AiPocketSearchRow } from '../contracts';

const outer = Date.UTC(2026, 0, 10);
const day = 86400000;
const start = outer - 9 * day;
const group = 'registered.ticker.moneyGroup';
const plan = {
  folds: [
    { trainStart: start, testStart: start + 4 * day, testEnd: start + 7 * day },
  ],
  baselineFeatures: ['old'],
  tickerGroups: [group],
  minimumEvents: 2,
};
const options = {
  ...resolveAiPocketSearchCommandOptions({ flags: {}, argv: [] }),
  testSince: outer,
  sealTest: true,
  scope: 'all',
  minProfitFactor: 0,
  explicitMinSupport: 1,
  explicitMinEvents: 1,
};
const rows: AiPocketSearchRow[] = Array.from({ length: 10 }, (_, i) => ({
  timestamp: start + i * day,
  exitTimestamp: start + i * day + 1000,
  profit: i + 1,
  profitableTrade: true,
  aiApproved: true,
  quality: 4,
  features: { old: i % 2, [group]: 'low' },
  symbol: 'AAAUSDT',
}));

it('purges labels that cross either fold boundary and keeps the outer test closed', () => {
  const input = rows.map((row) => ({ ...row }));
  input[3].exitTimestamp = plan.folds[0].testStart;
  input[6].exitTimestamp = plan.folds[0].testEnd;
  const result = runGateWalkForward(input, plan, options);
  expect(result.folds[0].support).toMatchObject({
    trainEvents: 3,
    testEvents: 2,
    purgedTrainRows: 1,
    purgedTestRows: 1,
  });
  expect(result.status).toBe('evaluated');
  expect(result.evaluatedEvents).toBe(2);
  const changed = input.map((row) =>
    row.timestamp! >= outer || row.exitTimestamp === plan.folds[0].testStart
      ? { ...row, profit: 999999, features: { old: 'unavailable' } }
      : row,
  );
  expect(runGateWalkForward(changed, plan, options)).toEqual(result);
});

it('rejects overlapping or outer test windows and reports group coverage shortage', () => {
  const fold = plan.folds[0];
  expect(() =>
    validateGateWalkForwardPlan({ ...plan, folds: [fold, fold] }, outer),
  ).toThrow('disjoint');
  expect(() =>
    validateGateWalkForwardPlan(
      { ...plan, folds: [{ ...fold, testEnd: outer + 1 }] },
      outer,
    ),
  ).toThrow('development');
  const missing = rows.map((row) => ({
    ...row,
    features: { old: 1, [group]: 'unknown' },
  }));
  expect(runGateWalkForward(missing, plan, options)).toMatchObject({
    status: 'insufficient-support',
    evaluatedEvents: 0,
  });
});

it('isolates the group contribution when only the augmented feature set finds a stable pocket', () => {
  const input: AiPocketSearchRow[] = Array.from({ length: 80 }, (_, i) => ({
    timestamp: start + i * 1000,
    exitTimestamp: start + i * 1000 + 1,
    profit: i % 2 === 0 ? 5 : -10,
    profitableTrade: i % 2 === 0,
    aiApproved: false,
    quality: 2,
    symbol: i % 4 < 2 ? 'AAAUSDT' : 'BBBUSDT',
    features: { old: 'same', [group]: i % 2 === 0 ? 'low' : 'high' },
  }));
  const result = runGateWalkForward(
    input,
    {
      ...plan,
      folds: [
        { trainStart: start, testStart: start + 60000, testEnd: start + 80000 },
      ],
    },
    { ...options, objective: 'add-to-gate', minTotalProfit: 1 },
  );
  expect(result.folds[0]).toMatchObject({
    B: { fallback: 'current-gate' },
    C: { fallback: null, predicates: [{ featureKey: group }] },
  });
  expect(result.comparisons.retraining.added.totalProfit).toBe(0);
  expect(result.comparisons.tickerGroups.added.totalProfit).toBe(50);
});
