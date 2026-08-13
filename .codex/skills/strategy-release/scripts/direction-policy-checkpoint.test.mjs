import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDirectionPolicyCheckpoint } from './direction-policy-checkpoint.mjs';

const rule = {
  minimumTrades: 144,
  minimumCadencePerDay: 0.1,
  minimumPnl: 0,
  minimumPnlPerTrade: 0,
  minimumProfitFactor: 1,
};

const metric = (trades, pnl, pnlPerTrade, profitFactor, cadencePerDay) => ({
  trades,
  pnl,
  pnlPerTrade,
  profitFactor,
  cadencePerDay,
});

test('requires LONG-only containment for the RelativeRotation control profile', () => {
  const decision = evaluateDirectionPolicyCheckpoint({
    usefulSideRule: rule,
    raw: {
      ALL: metric(1203, -39, -0.032, 0.995, 0.835),
      LONG: metric(886, 157.67, 0.178, 1.031, 0.615),
      SHORT: metric(317, -196.67, -0.62, 0.907, 0.22),
    },
  });

  assert.equal(decision.required, true);
  assert.equal(decision.trigger, 'losing_side_contamination');
  assert.equal(decision.retainedSide, 'LONG');
  assert.equal(decision.proposedPolicy, 'long_only');
});

test('requires recovery when a useful raw side has negligible gate approvals', () => {
  const decision = evaluateDirectionPolicyCheckpoint({
    usefulSideRule: rule,
    raw: {
      ALL: metric(500, 100, 0.2, 1.1, 0.5),
      LONG: metric(250, 120, 0.48, 1.2, 0.25),
      SHORT: metric(250, -20, -0.08, 0.97, 0.25),
    },
    gateApproved: {
      LONG: { trades: 0 },
      SHORT: { trades: 40 },
    },
  });

  assert.equal(decision.required, true);
  assert.equal(decision.trigger, 'profitable_side_hidden');
  assert.equal(decision.proposedPolicy, 'long_pass_through');
});

test('does not manufacture a side policy when neither side passes the frozen rule', () => {
  const decision = evaluateDirectionPolicyCheckpoint({
    usefulSideRule: rule,
    raw: {
      ALL: metric(500, -200, -0.4, 0.8, 0.5),
      LONG: metric(250, -80, -0.32, 0.9, 0.25),
      SHORT: metric(250, -120, -0.48, 0.85, 0.25),
    },
  });

  assert.equal(decision.required, false);
  assert.equal(decision.trigger, 'no_side_salvage');
  assert.equal(decision.proposedPolicy, 'both');
});

test('rejects incomplete metric inputs instead of guessing', () => {
  assert.throws(
    () =>
      evaluateDirectionPolicyCheckpoint({
        usefulSideRule: rule,
        raw: {
          ALL: metric(1, 1, 1, 1, 1),
          LONG: metric(1, 1, 1, 1, 1),
          SHORT: { trades: 1 },
        },
      }),
    /raw\.SHORT\.pnl must be finite/,
  );
});
