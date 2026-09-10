import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  generateFinalCompositionBoard,
  validateBoardSpec,
} from './final-composition-board.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sha = (character) => character.repeat(64);

const makeCandidate = ({
  id,
  role,
  label,
  color,
  pnl,
  trades,
  drawdown,
  artifactSha,
}) => ({
  id,
  role,
  label,
  status: 'eligible',
  color,
  riskUnit: 10,
  composition: {
    kind: 'core+deterministic-gate',
    gateSource: role === 'baseline' ? 'current' : 'variant',
    coreResearchId: `${id}-core`,
    coreConfigSha256: sha('a'),
    coreResult: { path: `${id}-core.json`, sha256: artifactSha },
    coreExport: { path: `${id}-export.jsonl`, sha256: artifactSha },
    gateReport: { path: `${id}-gate.json`, sha256: artifactSha },
    ...(role === 'baseline'
      ? {
          gateAuthority: {
            path: `${id}-authority.json`,
            sha256: artifactSha,
          },
        }
      : {}),
    gateFingerprint: sha('b'),
    configFingerprint: sha('c'),
    contextFingerprint: sha('d'),
    directionPolicy: 'both',
    minQuality: 4,
  },
  metrics: {
    trades,
    pnl,
    profitFactor: 1.5,
    maxDrawdown: drawdown,
  },
  terminal: [
    { days: 365, trades: Math.min(trades, 20), pnl: pnl * 0.5 },
    { days: 180, trades: Math.min(trades, 12), pnl: pnl * 0.3 },
    { days: 90, trades: Math.min(trades, 8), pnl: pnl * 0.2 },
    { days: 30, trades: Math.min(trades, 3), pnl: pnl * 0.1 },
    { days: 7, trades: Math.min(trades, 1), pnl: pnl * 0.05 },
  ],
  equity: [
    [1_700_000_000_000, 0],
    [1_710_000_000_000, pnl],
  ],
});

const makeSpec = (artifactSha) => ({
  schema: 'tradejs-final-composition-board/v1',
  strategy: 'ExampleStrategy',
  researchId: 'example-20260825-v1',
  title: 'ExampleStrategy final compositions',
  subtitle: 'Common cache-only comparison window',
  baselineId: 'baseline',
  selectedId: 'candidate',
  comparisonWindow: { start: 1_699_000_000_000, end: 1_711_000_000_000 },
  normalization: { pnlUnit: 'research PnL', maxLossValue: 10 },
  limitations: ['Untouched test support is small'],
  candidates: [
    makeCandidate({
      id: 'baseline',
      role: 'baseline',
      label: 'baseline + own gate',
      color: '#315f7d',
      pnl: 100,
      trades: 20,
      drawdown: 30,
      artifactSha,
    }),
    makeCandidate({
      id: 'candidate',
      role: 'candidate',
      label: 'candidate + own gate',
      color: '#d36b2c',
      pnl: 160,
      trades: 28,
      drawdown: 26,
      artifactSha,
    }),
  ],
});

test('rejects a raw-core row without a candidate-specific deterministic gate', () => {
  const spec = makeSpec(sha('e'));
  spec.candidates[1].composition.kind = 'raw-core';
  assert.throws(
    () => validateBoardSpec(spec),
    /composition\.kind must be core\+deterministic-gate/u,
  );
});

test('requires production core + current AI-gate as the baseline', () => {
  const spec = makeSpec(sha('e'));
  spec.candidates[0].composition.gateSource = 'variant';
  delete spec.candidates[0].composition.gateAuthority;
  assert.throws(
    () => validateBoardSpec(spec),
    /baseline must use the current AI-gate/u,
  );
});

test('requires the fixed terminal chart windows', () => {
  const spec = makeSpec(sha('e'));
  spec.candidates[1].terminal.pop();
  assert.throws(
    () => validateBoardSpec(spec),
    /must contain exactly 365d, 180d, 90d, 30d, and 7d/u,
  );
});

test('allows the current production baseline to remain selected', () => {
  const spec = makeSpec(sha('e'));
  spec.selectedId = 'baseline';
  spec.terminalComparisonIds = ['candidate'];
  const board = validateBoardSpec(spec);
  assert.equal(board.selectedId, 'baseline');
  assert.deepEqual(board.terminalComparisonIds, ['candidate']);
});

test('verifies candidate artifacts and renders the dashboard and equity board', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradejs-final-board-'));
  const contents = 'immutable-evidence\n';
  const artifactSha = hash(contents);
  for (const id of ['baseline', 'candidate']) {
    for (const suffix of ['core.json', 'export.jsonl', 'gate.json']) {
      await writeFile(path.join(root, `${id}-${suffix}`), contents, 'utf8');
    }
  }
  await writeFile(path.join(root, 'baseline-authority.json'), contents, 'utf8');
  const { summary } = await generateFinalCompositionBoard({
    spec: makeSpec(artifactSha),
    artifactRoot: root,
    outDir: path.join(root, 'charts'),
  });
  assert.equal(summary.candidates.length, 2);
  assert.match(summary.candidates[1].compositionFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(summary.artifacts).sort(), [
    'final-composition-dashboard.png',
    'final-composition-dashboard.svg',
    'final-composition-equity.png',
    'final-composition-equity.svg',
  ]);
  const dashboard = await readFile(
    path.join(root, 'charts', 'final-composition-dashboard.svg'),
    'utf8',
  );
  const equity = await readFile(
    path.join(root, 'charts', 'final-composition-equity.svg'),
    'utf8',
  );
  assert.match(dashboard, /PnL in terminal windows/u);
  assert.match(dashboard, /Final compositions: PnL ↔ drawdown/u);
  assert.match(equity, /Baseline = current gate behavior/u);
  assert.match(equity, /candidate \+ own gate/u);
  assert.match(equity, /Date \(UTC\)/u);
  for (const [, coordinates] of equity.matchAll(
    /<polyline points="([^"]+)"/gu,
  )) {
    const points = coordinates
      .split(' ')
      .map((point) => point.split(',').map(Number));
    assert.equal(points.length, 2, 'Do not insert synthetic step corners');
    assert.ok(points[1][0] > points[0][0]);
    assert.ok(points[1][1] < points[0][1], 'Join event samples directly');
  }
  assert.equal(summary.rendering.equityInterpolation, 'linear');
  assert.equal(summary.rendering.metricInputsChanged, false);
  assert.match(equity, /Nov 2023/u);
  assert.match(equity, /Mar 2024/u);
});

test('linear presentation preserves flat samples, peaks, troughs and frozen metrics', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradejs-final-board-'));
  const contents = 'immutable-evidence\n';
  const spec = makeSpec(hash(contents));
  spec.candidates[0].equity = [
    [1_700_000_000_000, 0],
    [1_701_000_000_000, 0],
    [1_703_000_000_000, 180],
    [1_706_000_000_000, -20],
    [1_710_000_000_000, 100],
  ];
  spec.candidates[0].metrics.maxDrawdown = 200;
  const frozenSpec = structuredClone(spec);
  for (const candidate of spec.candidates) {
    for (const key of [
      'coreResult',
      'coreExport',
      'gateReport',
      'gateAuthority',
    ]) {
      const reference = candidate.composition[key];
      if (reference) await writeFile(path.join(root, reference.path), contents);
    }
  }
  const { summary } = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: path.join(root, 'charts'),
    png: false,
  });
  const svg = await readFile(
    path.join(root, 'charts', 'final-composition-equity.svg'),
    'utf8',
  );
  const points = /<polyline points="([^"]+)"/u
    .exec(svg)[1]
    .split(' ')
    .map((point) => point.split(',').map(Number));
  assert.equal(points.length, frozenSpec.candidates[0].equity.length);
  assert.equal(
    points[0][1],
    points[1][1],
    'A flat observed interval stays flat',
  );
  assert.equal(
    Math.min(...points.map((p) => p[1])),
    points[2][1],
    'Keep the observed peak',
  );
  assert.equal(
    Math.max(...points.map((p) => p[1])),
    points[3][1],
    'Keep the observed trough',
  );
  for (let i = 1; i < points.length; i++)
    assert.ok(points[i][0] > points[i - 1][0]);
  assert.deepEqual(spec, frozenSpec, 'Rendering must not mutate evidence');
  assert.deepEqual(
    summary.candidates.map((c) => c.metrics),
    spec.candidates.map((c) => c.metrics),
  );
  assert.deepEqual(
    summary.candidates.map((c) => c.terminal),
    spec.candidates.map((c) => c.terminal),
  );
});

test('renders an additional terminal comparison without changing selectedId', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradejs-final-board-'));
  const contents = 'immutable-evidence\n';
  const artifactSha = hash(contents);
  const spec = makeSpec(artifactSha);
  spec.candidates.push(
    makeCandidate({
      id: 'transition',
      role: 'candidate',
      label: 'Transition breakout + own gate',
      color: '#a82f2f',
      pnl: 155,
      trades: 24,
      drawdown: 22,
      artifactSha,
    }),
  );
  spec.terminalComparisonIds = ['candidate', 'transition'];
  for (const id of ['baseline', 'candidate', 'transition']) {
    for (const suffix of ['core.json', 'export.jsonl', 'gate.json']) {
      await writeFile(path.join(root, `${id}-${suffix}`), contents, 'utf8');
    }
  }
  await writeFile(path.join(root, 'baseline-authority.json'), contents, 'utf8');

  const { summary } = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: path.join(root, 'charts'),
    png: false,
  });
  const dashboard = await readFile(
    path.join(root, 'charts', 'final-composition-dashboard.svg'),
    'utf8',
  );

  assert.equal(summary.selectedId, 'candidate');
  assert.deepEqual(summary.terminalComparisonIds, ['candidate', 'transition']);
  assert.match(dashboard, /data-terminal-series="baseline"/u);
  assert.match(dashboard, /data-terminal-series="candidate"/u);
  assert.match(dashboard, /data-terminal-series="transition"/u);
  assert.match(dashboard, /Transition breakout \+ own gate/u);
});

for (const candidateCount of [14, 20]) {
  test(`keeps every legend row visible for ${candidateCount} compositions and groups coincident point labels`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'tradejs-final-board-'));
    const contents = 'immutable-evidence\n';
    const artifactSha = hash(contents);
    const spec = makeSpec(artifactSha);
    for (let index = 2; index < candidateCount; index += 1) {
      spec.candidates.push(
        makeCandidate({
          id: `candidate-${index}`,
          role: 'candidate',
          label: `Composition ${index}`,
          color: '#315f7d',
          pnl: index < 4 ? 160 : index * 30,
          trades: 28,
          drawdown: index < 4 ? 26 : index * 7,
          artifactSha,
        }),
      );
    }
    for (const candidate of spec.candidates) {
      for (const artifact of [
        'coreResult',
        'coreExport',
        'gateReport',
        'gateAuthority',
      ]) {
        const reference = candidate.composition[artifact];
        if (reference)
          await writeFile(path.join(root, reference.path), contents);
      }
    }
    const { summary } = await generateFinalCompositionBoard({
      spec,
      artifactRoot: root,
      outDir: path.join(root, 'charts'),
    });
    assert.deepEqual(
      summary.candidates.map(({ metrics }) => metrics),
      spec.candidates.map(({ metrics }) => metrics),
    );
    const equity = await readFile(
      path.join(root, 'charts', 'final-composition-equity.svg'),
      'utf8',
    );
    const height = Number(/<svg[^>]* height="(\d+)"/u.exec(equity)[1]);
    const legends = [
      ...equity.matchAll(
        /data-equity-legend="([^"]+)" transform="translate\([^,]+,([\d.]+)\)"/gu,
      ),
    ];
    assert.equal(legends.length, candidateCount);
    for (const [, id, top] of legends) {
      assert.ok(
        Number(top) + 42 < height - 24,
        `${id}: legend label and metrics must fit with bottom margin`,
      );
    }
    const { default: sharp } = await import('sharp');
    const image = sharp(
      await readFile(path.join(root, 'charts', 'final-composition-equity.png')),
    );
    assert.equal((await image.metadata()).height, height);
    const lastRowTop = Number(legends.at(-1)[2]);
    const pixels = await image
      .extract({ left: 110, top: lastRowTop, width: 500, height: 42 })
      .stats();
    assert.ok(
      pixels.channels.some(({ min }) => min < 200),
      'Last legend row must be painted inside the PNG',
    );
    const dashboard = await readFile(
      path.join(root, 'charts', 'final-composition-dashboard.svg'),
      'utf8',
    );
    const points = [
      ...dashboard.matchAll(
        /data-scatter-point="([^"]+)" cx="([^"]+)" cy="([^"]+)"/gu,
      ),
    ];
    assert.equal(points.length, candidateCount);
    const coincident = points.filter(([, id]) =>
      ['candidate', 'candidate-2', 'candidate-3'].includes(id),
    );
    assert.equal(
      new Set(coincident.map(([, , x, y]) => `${x},${y}`)).size,
      1,
      'Coincident data points must not be jittered',
    );
    assert.match(
      dashboard,
      /data-point-label-ids="candidate,candidate-2,candidate-3"[^>]*>A \/ B \/ C<\/text>/u,
    );
    assert.equal(
      [...dashboard.matchAll(/data-point-label-ids=/gu)].length,
      candidateCount - 2,
    );
  });
}
