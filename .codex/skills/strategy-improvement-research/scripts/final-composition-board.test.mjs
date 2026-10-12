import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  generateFinalCompositionBoard,
  validateBoardSpec,
  renderExecutedPresentation,
} from './final-composition-board.mjs';
import { executedFixture } from './executed-composition-report.test.mjs';
import {
  deriveExecutedCompositionReport,
  FROZEN_COMPOSITION_CRITERIA,
} from './executed-composition-report.mjs';
import { buildFinalCompositionSpec } from './build-final-composition-spec.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const sha = (character) => character.repeat(64);

const assertLabelLayout = (canvas) => {
  assert.ok(canvas.width * canvas.height <= 200_000_000);
  for (const [i, a] of canvas.boxes.entries()) {
    assert.ok(
      a.x >= 0 &&
        a.y >= 0 &&
        a.x + a.width <= canvas.width &&
        a.y + a.height <= canvas.height,
      JSON.stringify(a),
    );
    for (const b of canvas.boxes.slice(i + 1).filter((b) => b.lane === a.lane))
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        `Overlapping ${a.lane}: ${JSON.stringify([a, b])}`,
      );
  }
};

test('twenty real synthetic closed-loop reports paginate all 3960 cells, full fields, axes, PNGs and unchanged authority', async (t) => {
  const root =
    process.env.TRADEJS_GRAPHICS_FIXTURE_ROOT ||
    (await mkdtemp(path.join(os.tmpdir(), 'executed-pages-')));
  await mkdir(root, { recursive: true });
  const ids = Array.from({ length: 20 }, (_, i) =>
    i === 0 ? 'baseline' : `candidate-${i}`,
  );
  const selectionValue = {
    criteria: FROZEN_COMPOSITION_CRITERIA,
    candidateIds: ids,
    baselineSelectionEligible: false,
    tieBreaker: { orderedTrainCandidateIds: ids.slice().reverse() },
  };
  const bytes = JSON.stringify(selectionValue) + '\n';
  await writeFile(path.join(root, 'selection.json'), bytes, { flag: 'wx' });
  const selectionAuthority = { path: 'selection.json', sha256: hash(bytes) },
    candidates = [];
  for (const [i, id] of ids.entries()) {
    const fixture = executedFixture(t, {
      id,
      sharedRoot: root,
      selectionAuthority,
      zero: i === 0,
      accepted: i !== 19,
      trades: i === 0 ? [] : [{ pnl: i % 2 ? -2 : 2 }],
    });
    const result = await deriveExecutedCompositionReport({
      projectRoot: root,
      descriptor: fixture.descriptor,
      validators: fixture.validators,
      outputPrefix: `${id}-report`,
    });
    candidates.push({
      id,
      label: `Long candidate label ${'abcdefgh '.repeat(30)} ${i}`,
      role: i === 0 ? 'baseline' : 'candidate',
      gateSource: i === 0 ? 'current' : 'variant',
      color: i % 2 ? '#d36b2c' : '#315f7d',
      executedCompositionAuthority: fixture.descriptor,
      executedCompositionReport: result.reportDescriptor,
      executedCompositionReceipt: result.receiptDescriptor,
    });
  }
  const spec = await buildFinalCompositionSpec({
    selection: {
      schema: 'tradejs-final-composition-selection/v1',
      executionBasis: 'closed-loop-execution',
      metricBasis: 'completed-trade',
      strategy: 'Example',
      researchId: 'synthetic',
      title: 'Synthetic pagination',
      subtitle: 'Not research outcomes',
      baselineId: 'baseline',
      comparisonWindow: { start: 1665273600000, end: 1791504000000 },
      normalization: { maxLossValue: 10, pnlUnit: 'research PnL' },
      selectionAuthority,
      limitations: ['Synthetic only'],
      candidates,
    },
    artifactRoot: root,
  });
  const frozen = JSON.stringify(spec),
    curves = spec.candidates.map((c, i) => ({
      points:
        i === 0 ? [] : [[spec.comparisonWindow.start + 10000, c.metrics.pnl]],
      fullResolutionRows: i === 0 ? 0 : 1,
    }));
  const rendered = renderExecutedPresentation({
    board: spec,
    curves,
    criteria: selectionValue.criteria,
  });
  for (const canvas of [rendered.dashboard, rendered.equity, ...rendered.pages])
    assertLabelLayout(canvas);
  assert.equal(rendered.pages.length, 20);
  assert.equal(rendered.appendix.length, 3960);
  assert.equal(
    [...rendered.dashboard.svg.matchAll(/data-kpi-row=/g)].length,
    20,
  );
  assert.equal(
    [...rendered.dashboard.svg.matchAll(/data-terminal-candidate=/g)].length,
    100,
  );
  assert.equal(
    [...rendered.dashboard.svg.matchAll(/data-scatter-label=/g)].length,
    20,
  );
  assert.equal(
    [...rendered.dashboard.svg.matchAll(/data-criteria-candidate=/g)].length,
    20,
  );
  assert.match(rendered.dashboard.svg, /test-profit-factor/);
  assert.match(rendered.dashboard.svg, /stress-profit-factor/);
  const scatterPoints = [
    ...rendered.dashboard.svg.matchAll(
      /data-scatter-point="([^"]+)" cx="([^"]+)" cy="([^"]+)"/g,
    ),
  ];
  assert.deepEqual(
    scatterPoints.find((p) => p[1] === 'candidate-1').slice(2),
    scatterPoints.find((p) => p[1] === 'candidate-3').slice(2),
    'Coincident economic points are never jittered',
  );
  for (const sign of [-1, 1]) {
    const signed = structuredClone(spec);
    signed.candidates.forEach((c, i) => {
      c.metrics.pnl = sign * (i + 1);
    });
    const view = renderExecutedPresentation({
      board: signed,
      curves,
      criteria: selectionValue.criteria,
    });
    assertLabelLayout(view.dashboard);
    assert.match(view.dashboard.svg, /data-pnl-tick="0"/);
  }
  const unavailable = structuredClone(spec);
  unavailable.candidates[19].equity.status = 'unavailable';
  const unavailableView = renderExecutedPresentation({
    board: unavailable,
    curves: curves.map(() => ({ points: [], fullResolutionRows: 0 })),
    criteria: selectionValue.criteria,
  });
  assert.ok(
    !unavailableView.equity.svg.includes('data-zero-guide="candidate-19"'),
  );
  assert.match(
    unavailableView.equity.svg.replace(/<[^>]*>/g, ''),
    /equity unavailable \(UNKNOWN\)/,
  );
  for (const [i, page] of rendered.pages.entries()) {
    const expected = ['observed', 'stress20bps'].flatMap((basis) =>
      ['exitWindow', 'decisionPartition'].flatMap((axis) =>
        spec.candidates[i].matrices[basis][axis].map(
          (cell) =>
            `${ids[i]}/${basis}/${axis}/${cell.id}/${cell.symbolGroupId}/${cell.direction}`,
        ),
      ),
    );
    assert.deepEqual(page.cellIdentities, expected);
    assert.equal(new Set(expected).size, 198);
    assert.equal([...page.svg.matchAll(/data-matrix-cell=/g)].length, 198);
  }
  for (const points of [
    [
      [spec.comparisonWindow.start + 1, 10],
      [spec.comparisonWindow.end - 1, 20],
    ],
    [
      [spec.comparisonWindow.start + 1, -20],
      [spec.comparisonWindow.end - 1, -10],
    ],
    [],
  ]) {
    const r = renderExecutedPresentation({
      board: spec,
      curves: curves.map((c) => ({ ...c, points })),
      criteria: selectionValue.criteria,
    });
    assertLabelLayout(r.equity);
    assert.match(r.equity.svg, /data-pnl-tick="0"/);
    assert.match(
      r.equity.svg,
      new RegExp(`data-utc-tick="${spec.comparisonWindow.start}"`),
    );
    assert.match(
      r.equity.svg,
      new RegExp(`data-utc-tick="${spec.comparisonWindow.end}"`),
    );
    assert.ok([...r.equity.svg.matchAll(/data-utc-tick=/g)].length <= 7);
  }
  assert.throws(
    () => renderExecutedPresentation({ board: spec, curves, pixelLimit: 100 }),
    /pixel budget/,
  );
  const oversized = structuredClone(spec);
  oversized.candidates[19].label = 'x'.repeat(1_200_000);
  await assert.rejects(
    generateFinalCompositionBoard({
      spec: oversized,
      artifactRoot: root,
      outDir: 'oversized',
      png: true,
    }),
    /pixel budget/,
  );
  await assert.rejects(access(path.join(root, 'oversized')), /ENOENT/);
  const output = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: 'charts',
    png: true,
  });
  assert.equal(JSON.stringify(spec), frozen);
  assert.equal(output.summary.selectedId, spec.selectedId);
  assert.equal(output.summary.selectionDisposition, spec.selectionDisposition);
  assert.deepEqual(
    output.summary.candidates.map((c) => c.matrices),
    spec.candidates.map((c) => c.matrices),
  );
  assert.equal(output.summary.rendering.matrixPages.length, 20);
  for (const page of output.summary.rendering.matrixPages) {
    assert.equal(page.svg.sha256, output.summary.artifacts[page.svg.path]);
    assert.equal(page.png.sha256, output.summary.artifacts[page.png.path]);
  }
  assert.equal(Object.keys(output.summary.artifacts).length, 46);
  for (const [name, checksum] of Object.entries(output.summary.artifacts))
    assert.equal(
      hash(await readFile(path.join(root, 'charts', name))),
      checksum,
    );
  const appendix = JSON.parse(
    await readFile(
      path.join(root, 'charts/final-composition-metrics.json'),
      'utf8',
    ),
  );
  assert.deepEqual(appendix.cells, rendered.appendix);
  const readable = await readFile(
    path.join(root, 'charts/final-composition-metrics.md'),
    'utf8',
  );
  for (const key of Object.keys(appendix.cells[0].cell))
    assert.ok(readable.includes(`| ${key} |`));
  const repeat = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: 'repeat-charts',
    png: false,
  });
  assert.deepEqual(
    repeat.summary.candidates.map((c) => c.compositionFingerprint),
    output.summary.candidates.map((c) => c.compositionFingerprint),
  );
  for (const c of output.summary.candidates) {
    const original = spec.candidates.find((s) => s.id === c.id);
    assert.deepEqual(c.metrics, original.metrics);
    assert.deepEqual(c.selectionDecision, original.selectionDecision);
  }
  await assert.rejects(
    generateFinalCompositionBoard({
      spec,
      artifactRoot: root,
      outDir: 'charts',
      png: false,
    }),
    /EEXIST/,
  );
  assert.equal(
    hash(
      await readFile(path.join(root, 'charts/final-composition-dashboard.svg')),
    ),
    output.summary.artifacts['final-composition-dashboard.svg'],
  );
});

test('closed-loop board refuses raw/posthoc rows and missing actual report authority', () => {
  const spec = makeSpec(sha('e'));
  spec.executionBasis = 'closed-loop-execution';
  spec.metricBasis = 'completed-trade';
  assert.throws(() => validateBoardSpec(spec), /Raw\/posthoc/);
});

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

test('null selection preserves diagnostic comparisons and rejects missing selection', () => {
  const spec = makeSpec(sha('e'));
  spec.selectedId = null;
  assert.equal(validateBoardSpec(spec).selectedId, null);
  assert.deepEqual(validateBoardSpec(spec).terminalComparisonIds, [
    'candidate',
  ]);
  spec.terminalComparisonIds = ['unknown'];
  assert.throws(() => validateBoardSpec(spec), /must identify candidates/u);
  delete spec.terminalComparisonIds;
  delete spec.selectedId;
  assert.throws(() => validateBoardSpec(spec), /selectedId/u);
});

test('null selection displays exact zero baseline diagnostics without a winner and retains all curves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradejs-null-board-'));
  const contents = 'immutable-evidence\n';
  const spec = makeSpec(hash(contents));
  spec.selectedId = null;
  spec.candidates[0].metrics = {
    trades: 0,
    pnl: 0,
    profitFactor: null,
    maxDrawdown: 0,
  };
  spec.candidates[0].terminal = spec.candidates[0].terminal.map((row) => ({
    ...row,
    trades: 0,
    pnl: 0,
  }));
  spec.candidates[0].equity = spec.candidates[0].equity.map(([timestamp]) => [
    timestamp,
    0,
  ]);
  for (let i = 2; i <= 4; i++) {
    const candidate = structuredClone(spec.candidates[1]);
    candidate.id = `candidate-${i}`;
    candidate.label = `diagnostic candidate ${i}`;
    candidate.status = 'research-only';
    spec.candidates.push(candidate);
  }
  spec.terminalComparisonIds = ['candidate', 'candidate-2', 'candidate-3'];
  for (const id of ['baseline', 'candidate']) {
    for (const suffix of ['core.json', 'export.jsonl', 'gate.json']) {
      await writeFile(path.join(root, `${id}-${suffix}`), contents, 'utf8');
    }
  }
  await writeFile(path.join(root, 'baseline-authority.json'), contents, 'utf8');
  const { summary } = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: path.join(root, 'charts'),
  });
  const dashboard = await readFile(
    path.join(root, 'charts', 'final-composition-dashboard.svg'),
    'utf8',
  );
  const equity = await readFile(
    path.join(root, 'charts', 'final-composition-equity.svg'),
    'utf8',
  );
  assert.equal(summary.selectedId, null);
  assert.equal(summary.candidates.length, 5);
  assert.deepEqual(summary.candidates[0].metrics, spec.candidates[0].metrics);
  assert.match(dashboard, /No eligible composition/u);
  assert.match(dashboard, /Baseline diagnostics/u);
  assert.match(dashboard, /Trades<\/text><text[^>]+>0<\/text>/u);
  assert.match(dashboard, /PnL<\/text><text[^>]+>0\.00<\/text>/u);
  assert.match(dashboard, /Max drawdown<\/text><text[^>]+>0\.00<\/text>/u);
  assert.equal([...dashboard.matchAll(/Baseline diagnostics/gu)].length, 4);
  assert.equal([...equity.matchAll(/<polyline /gu)].length, 5);
  assert.match(equity, /No eligible composition/u);
  assert.doesNotMatch(equity, /Selected:/u);
  assert.doesNotMatch(dashboard, /opacity="0\.18"|stroke="#7a321b"/u);
  assert.doesNotMatch(dashboard + equity, /NaN|Infinity|undefined/u);
  for (const candidate of spec.candidates) {
    assert.ok(dashboard.includes(`data-scatter-point="${candidate.id}"`));
    assert.ok(equity.includes(`data-equity-legend="${candidate.id}"`));
  }
  for (const id of spec.terminalComparisonIds) {
    assert.ok(dashboard.includes(`data-terminal-series="${id}"`));
  }
  const before = summary.candidates.map((c) => c.compositionFingerprint);
  spec.selectedId = 'candidate';
  const selected = validateBoardSpec(spec);
  assert.deepEqual(
    selected.candidates.map((c) => c.compositionFingerprint),
    before,
  );
});

test('checksum verifies compiled candidate authority and binds it into the composition fingerprint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tradejs-compiled-board-'));
  const contents = 'compiled-evidence\n';
  const artifactSha = hash(contents);
  const spec = makeSpec(artifactSha);
  spec.metricBasis = 'completed-trade';
  const original = validateBoardSpec(spec).candidates[1].compositionFingerprint;
  spec.candidates[1].composition.compiledGateAuthority = {
    path: 'compiled-authority.json',
    sha256: artifactSha,
  };
  const compiled = validateBoardSpec(spec);
  assert.notEqual(compiled.candidates[1].compositionFingerprint, original);
  for (const id of ['baseline', 'candidate']) {
    for (const suffix of ['core.json', 'export.jsonl', 'gate.json']) {
      await writeFile(path.join(root, `${id}-${suffix}`), contents, 'utf8');
    }
  }
  await writeFile(path.join(root, 'baseline-authority.json'), contents, 'utf8');
  await writeFile(
    path.join(root, 'compiled-authority.json'),
    'tampered\n',
    'utf8',
  );
  await assert.rejects(
    generateFinalCompositionBoard({
      spec,
      artifactRoot: root,
      outDir: path.join(root, 'charts'),
    }),
    /checksum|SHA-256/iu,
  );
  await writeFile(path.join(root, 'compiled-authority.json'), contents, 'utf8');
  const { summary } = await generateFinalCompositionBoard({
    spec,
    artifactRoot: root,
    outDir: path.join(root, 'charts'),
  });
  assert.equal(
    summary.candidates[1].composition.compiledGateAuthority.sha256,
    artifactSha,
  );
  spec.candidates[0].composition.compiledGateAuthority =
    spec.candidates[1].composition.compiledGateAuthority;
  assert.equal(summary.metricBasis, 'completed-trade');
  assert.throws(() => validateBoardSpec(spec), /reserved for candidate gates/u);
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
  assert.equal(
    summary.artifacts['final-composition-dashboard.svg'],
    '8644e43bf33d1d77c28fffd7af35f69f1e3378a5d7363f1704cccfb848ae33a4',
  );
  assert.equal(
    summary.artifacts['final-composition-equity.svg'],
    '60b8f373994e272f46ece0fb2028033ffdce19f2ca55c55ac208642c17ada861',
  );
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
