import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFrozenGateSpec } from './freeze-gate-variants.mjs';

test('freezes no more than five causal replacement gates', () => {
  const pocket = (index) => ({
    predicates: [
      { label: `feature.value >= ${index}` },
      { label: 'derived.direction == SHORT' },
    ],
    summary: { support: 25 + index, events: 25 },
  });
  const spec = buildFrozenGateSpec({
    report: {
      run: {
        featurePolicy: 'causal-stationary',
        until: 1,
        trainRows: 100,
        validationRows: 0,
        testRows: 0,
      },
      pocketSearch: { positivePockets: Array.from({ length: 6 }, (_, index) => pocket(index)) },
    },
    candidateId: 'candidate-a',
    limit: 5,
    sourcePath: 'pocket.json',
    sourceSha256: 'a'.repeat(64),
  });

  assert.equal(spec.variants.length, 5);
  assert.equal(spec.variants[0].mode, 'replace');
  assert.equal(spec.variants[0].quality, 4);
  assert.equal(
    spec.variants[0].expression,
    'feature.value >= 0 && derived.direction == SHORT',
  );
});

test('rejects pocket reports with a non-causal feature policy', () => {
  assert.throws(
    () =>
      buildFrozenGateSpec({
        report: { run: { featurePolicy: 'all' }, pocketSearch: { positivePockets: [{}] } },
        candidateId: 'candidate-a',
        limit: 1,
        sourcePath: 'pocket.json',
        sourceSha256: 'a'.repeat(64),
      }),
    /causal-stationary/,
  );
});
