import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateReleaseProgress } from './release-progress-checkpoint.mjs';

const input = (overrides = {}) => ({
  historyAuditComplete: true,
  baseline: { complete: true, reconciled: true },
  opportunityMapComplete: true,
  hypothesisPortfolioFrozen: true,
  families: [
    { id: 'lifecycle', status: 'active', roundsCompleted: 0 },
    { id: 'geometry', status: 'active', roundsCompleted: 0 },
    { id: 'participation', status: 'active', roundsCompleted: 0 },
  ],
  rescueBoardComplete: false,
  directionPolicyCheckpoint: { required: false, complete: false },
  fullAiReportComplete: false,
  chartComplete: false,
  limitations: [],
  ...overrides,
});

test('requires LiquidityTails round 1 despite retrospective universe provenance', () => {
  const result = evaluateReleaseProgress(
    input({
      limitations: [
        'retrospective_current_universe',
        'missing_effective_dated_membership',
        'exposed_holdout',
      ],
    }),
  );

  assert.equal(result.nextAction, 'RUN_CORE_ROUND_1');
  assert.equal(result.phase, 'core');
  assert.equal(result.evidenceCeiling, 'micro_forward_only');
  assert.equal(result.verdictAllowed, false);
});

test('allows a completed limited-provenance contour to decide micro-forward', () => {
  const result = evaluateReleaseProgress(
    input({
      families: [
        { id: 'lifecycle', status: 'active', roundsCompleted: 3 },
        {
          id: 'geometry',
          status: 'retired',
          roundsCompleted: 1,
          hardStopReason: 'mechanism_falsified',
        },
        { id: 'participation', status: 'active', roundsCompleted: 3 },
      ],
      rescueBoardComplete: true,
      directionPolicyCheckpoint: { required: false, complete: false },
      fullAiReportComplete: true,
      chartComplete: true,
      limitations: ['retrospective_current_universe', 'exposed_holdout'],
    }),
  );

  assert.equal(result.status, 'complete');
  assert.equal(result.verdictAllowed, true);
  assert.equal(result.nextAction, 'DECIDE_PROSPECTIVE_MICRO_FORWARD');
  assert.equal(result.evidenceCeiling, 'micro_forward_only');
});

test('stops only the invalid evidence path on causal leakage', () => {
  const result = evaluateReleaseProgress(
    input({ limitations: ['causal_leakage'] }),
  );

  assert.equal(result.nextAction, 'REPAIR_INVALID_EVIDENCE');
  assert.equal(result.evidenceCeiling, 'invalid_evidence');
  assert.equal(result.verdictAllowed, false);
});

test('does not let a registry fix substitute for a core round', () => {
  const result = evaluateReleaseProgress(
    input({ limitations: ['missing_historical_patch'] }),
  );

  assert.equal(result.nextAction, 'RUN_CORE_ROUND_1');
  assert.match(result.reason, /do not consume this round/);
});

test('requires causal diagnosis rather than jumping from audit to variants', () => {
  const result = evaluateReleaseProgress(
    input({ opportunityMapComplete: false, hypothesisPortfolioFrozen: false }),
  );

  assert.equal(result.nextAction, 'BUILD_OPPORTUNITY_MAP');
  assert.equal(result.phase, 'diagnosis');
});

test('runs round 1 across families before starting round 2', () => {
  const result = evaluateReleaseProgress(
    input({
      families: [
        { id: 'lifecycle', status: 'active', roundsCompleted: 1 },
        { id: 'geometry', status: 'active', roundsCompleted: 0 },
        { id: 'participation', status: 'active', roundsCompleted: 0 },
      ],
    }),
  );

  assert.equal(result.nextAction, 'RUN_CORE_ROUND_1');
  assert.match(result.reason, /geometry/);
});

test('requires a reason when a family is retired early', () => {
  assert.throws(
    () =>
      evaluateReleaseProgress(
        input({
          families: [
            { id: 'lifecycle', status: 'retired', roundsCompleted: 0 },
            { id: 'geometry', status: 'active', roundsCompleted: 3 },
            { id: 'participation', status: 'active', roundsCompleted: 3 },
          ],
        }),
      ),
    /requires hardStopReason/,
  );
});
