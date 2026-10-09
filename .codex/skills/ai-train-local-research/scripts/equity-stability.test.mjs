import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeEquityStability,
  buildEquityStabilityReport,
} from './equity-stability.mjs';
const day = 86400000;
test('monotone and inactive zero curves do not invent drawdowns', () => {
  for (const points of [
    [
      [0, 0],
      [day, 10],
      [3 * day, 20],
    ],
    [
      [0, 0],
      [3 * day, 0],
    ],
  ]) {
    const result = summarizeEquityStability(points);
    assert.equal(result.maxDrawdown, 0);
    assert.equal(result.underwaterDays, 0);
    assert.equal(result.calendarUlcerIndex, 0);
    assert.equal(result.recoveryRightCensored, false);
  }
});
test('duration weights inactive drawdown time and includes terminal loss', () => {
  const r = summarizeEquityStability([
    [0, 0],
    [day, 10],
    [2 * day, 0],
    [4 * day, 10],
    [5 * day, 5],
    [7 * day, 5],
  ]);
  assert.equal(r.underwaterDays, 4);
  assert.equal(r.maxUnderwaterDays, 2);
  assert.equal(r.maxRecoveryDays, 3);
  assert.equal(r.recoveryRightCensored, true);
  assert.equal(r.calendarUlcerIndex, Math.sqrt(250 / 7));
});
test('tied timestamps aggregate without artificial calendar time', () => {
  const r = summarizeEquityStability([
    [0, 0],
    [day, -10],
    [day, 0],
    [2 * day, 0],
  ]);
  assert.equal(r.underwaterDays, 0);
  assert.equal(r.maxDrawdown, 10);
});
test('unrecovered loss starts at initial zero, not first trade price', () => {
  const r = summarizeEquityStability([
    [0, 0],
    [day, -10],
    [4 * day, -10],
  ]);
  assert.equal(r.maxRecoveryDays, 4);
  assert.equal(r.maxUnderwaterDays, 3);
  assert.equal(r.calendarUlcerIndex, Math.sqrt(75));
});
test('rejects incomplete, nonfinite and inverted evidence', () => {
  assert.throws(() => summarizeEquityStability([]));
  assert.throws(() =>
    summarizeEquityStability([
      [1, 0],
      [0, 1],
    ]),
  );
  assert.throws(() =>
    summarizeEquityStability([
      [0, 0],
      [1, NaN],
    ]),
  );
  assert.throws(() =>
    buildEquityStabilityReport({ baseline: {}, variants: [] }),
  );
});
test('builder preserves policies and demands realized evidence', () => {
  const r = buildEquityStabilityReport({
    baseline: {
      realized: {
        equity: [
          [0, 0],
          [day, 1],
        ],
      },
    },
    variants: [
      {
        name: 'candidate',
        realized: {
          equity: [
            [0, 0],
            [day, -1],
          ],
        },
      },
    ],
  });
  assert.deepEqual(
    r.policies.map((p) => p.name),
    ['baseline', 'candidate'],
  );
  assert.equal(r.policies[1].recoveryRightCensored, true);
});
