import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateDirectionalParameterCheckpoint } from './directional-parameter-checkpoint.mjs';

const input = (overrides = {}) => ({
  parameter: {
    name: 'ENTRY_THRESHOLD',
    isolatedChange: true,
    legacyFallbackSupported: true,
    resolution: 'decision_time',
  },
  evidence: {
    complete: true,
    reconciled: true,
    intendedTransitionChanged: true,
    LONG: { effect: 'improved', supportAdequate: true },
    SHORT: { effect: 'worsened', supportAdequate: true },
  },
  ...overrides,
});

test('requires a LONG override for an opposing matched side effect', () => {
  const result = evaluateDirectionalParameterCheckpoint(input());

  assert.equal(result.required, true);
  assert.equal(result.targetDirection, 'LONG');
  assert.equal(result.implementationMode, 'fallback_override');
  assert.equal(result.action, 'FREEZE_DIRECTIONAL_PARAMETER_SPLIT');
});

test('mirrors the target direction and requires detector state isolation', () => {
  const result = evaluateDirectionalParameterCheckpoint(
    input({
      parameter: {
        name: 'ZONE_LOOKBACK',
        isolatedChange: true,
        legacyFallbackSupported: true,
        resolution: 'detector_state',
      },
      evidence: {
        complete: true,
        reconciled: true,
        intendedTransitionChanged: true,
        LONG: { effect: 'worsened', supportAdequate: true },
        SHORT: { effect: 'improved', supportAdequate: true },
      },
    }),
  );

  assert.equal(result.targetDirection, 'SHORT');
  assert.equal(result.implementationMode, 'separate_directional_state');
  assert.equal(result.action, 'DESIGN_DIRECTIONAL_STATE_ISOLATION');
});

test('keeps a globally useful parameter global', () => {
  const result = evaluateDirectionalParameterCheckpoint(
    input({
      evidence: {
        complete: true,
        reconciled: true,
        intendedTransitionChanged: true,
        LONG: { effect: 'improved', supportAdequate: true },
        SHORT: { effect: 'improved', supportAdequate: true },
      },
    }),
  );

  assert.equal(result.required, false);
  assert.equal(result.action, 'KEEP_GLOBAL_PARAMETER');
});

test('requires a single-parameter ablation before splitting a bundle', () => {
  const result = evaluateDirectionalParameterCheckpoint(
    input({
      parameter: {
        name: 'ENTRY_THRESHOLD',
        isolatedChange: false,
        legacyFallbackSupported: true,
        resolution: 'decision_time',
      },
    }),
  );

  assert.equal(result.required, false);
  assert.equal(result.action, 'RUN_SINGLE_PARAMETER_ABLATION');
});

test('does not split under insufficient side support', () => {
  const result = evaluateDirectionalParameterCheckpoint(
    input({
      evidence: {
        complete: true,
        reconciled: true,
        intendedTransitionChanged: true,
        LONG: { effect: 'improved', supportAdequate: true },
        SHORT: { effect: 'worsened', supportAdequate: false },
      },
    }),
  );

  assert.equal(result.required, false);
  assert.equal(result.action, 'COLLECT_DIRECTIONAL_EVIDENCE');
});

test('requires a backward-compatible fallback contract', () => {
  const result = evaluateDirectionalParameterCheckpoint(
    input({
      parameter: {
        name: 'ENTRY_THRESHOLD',
        isolatedChange: true,
        legacyFallbackSupported: false,
        resolution: 'shared_lifecycle',
      },
    }),
  );

  assert.equal(result.required, true);
  assert.equal(result.action, 'DESIGN_LEGACY_FALLBACK');
});
