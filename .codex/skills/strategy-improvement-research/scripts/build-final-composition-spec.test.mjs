import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildFinalCompositionSpec } from './build-final-composition-spec.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const periods = (totalProfit) =>
  Object.fromEntries(
    ['full', '365d', '180d', '90d', '30d', '7d'].map((key) => [
      key,
      {
        trades: 1,
        totalProfit,
        profitFactor: 2,
        maxDrawdown: 1,
      },
    ]),
  );

const makeSelection = (fingerprint) => ({
  schema: 'tradejs-final-composition-selection/v1',
  strategy: 'Example',
  researchId: 'example-v1',
  title: 'Example',
  subtitle: 'Example',
  baselineId: 'current-baseline',
  selectedId: 'current-baseline',
  terminalComparisonIds: ['rebuilt-own-gate'],
  comparisonWindow: { start: 1, end: 3 },
  normalization: { pnlUnit: 'PnL', maxLossValue: 10 },
  contextFingerprint: fingerprint,
  limitations: [],
  candidates: [
    {
      id: 'current-baseline',
      label: 'production core + current AI-gate',
      role: 'baseline',
      status: 'production-control',
      color: '#000000',
      gateSource: 'current',
      gateAuthority: 'authority.json',
      coreResearchId: 'core',
      coreConfigSha256: fingerprint,
      coreResult: 'core.json',
      coreExport: 'export.jsonl',
      gateReport: 'gate.json',
      directionPolicy: 'both',
    },
    {
      id: 'rebuilt-own-gate',
      label: 'production core + rebuilt own gate',
      role: 'candidate',
      status: 'research-only',
      color: '#ffffff',
      gateSource: 'variant',
      coreResearchId: 'core',
      coreConfigSha256: fingerprint,
      coreResult: 'core.json',
      coreExport: 'export.jsonl',
      gateReport: 'gate.json',
      variantName: 'own-gate',
      directionPolicy: 'both',
    },
  ],
});

const createFixture = async (t) => {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'final-composition-spec-'),
  );
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const exportContents = '{}\n';
  await Promise.all([
    fsp.writeFile(path.join(root, 'core.json'), '{}\n'),
    fsp.writeFile(path.join(root, 'export.jsonl'), exportContents),
    fsp.writeFile(
      path.join(root, 'authority.json'),
      JSON.stringify({
        run: {
          mode: 'local-deterministic',
          minQuality: 4,
          directionPolicy: 'both',
        },
        research: {
          lineage: {
            gateFingerprint: 'runtime-gate-v1',
            sourceSha256s: [sha256(exportContents)],
          },
        },
      }),
    ),
    fsp.writeFile(
      path.join(root, 'gate.json'),
      JSON.stringify({
        run: { minQuality: 4 },
        baseline: {
          equity: [
            [1, 0],
            [2, 7],
          ],
          periods: periods(7),
        },
        variants: [
          {
            name: 'own-gate',
            mode: 'replace',
            quality: 4,
            direction: null,
            expression: 'true',
            equity: [
              [1, 0],
              [2, 5],
            ],
            periods: periods(5),
          },
        ],
      }),
    ),
  ]);
  return root;
};

test('uses current gate as baseline and rebuilt gate as a separate candidate', async (t) => {
  const root = await createFixture(t);
  const spec = await buildFinalCompositionSpec({
    artifactRoot: root,
    selection: makeSelection('a'.repeat(64)),
  });

  assert.equal(spec.baselineId, 'current-baseline');
  assert.equal(spec.candidates[0].composition.gateSource, 'current');
  assert.match(
    spec.candidates[0].composition.gateAuthority.sha256,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(spec.candidates[0].metrics.pnl, 7);
  assert.equal(spec.candidates[1].composition.gateSource, 'variant');
  assert.equal(spec.candidates[1].metrics.pnl, 5);
  assert.deepEqual(spec.candidates[0].equity, [
    [1, 0],
    [2, 7],
  ]);
  assert.deepEqual(spec.terminalComparisonIds, ['rebuilt-own-gate']);
});

test('rejects a rebuilt gate as the declared baseline', async (t) => {
  const root = await createFixture(t);
  const selection = makeSelection('a'.repeat(64));
  selection.candidates[0].gateSource = 'variant';
  await assert.rejects(
    buildFinalCompositionSpec({ artifactRoot: root, selection }),
    /production core \+ current AI-gate/u,
  );
});
