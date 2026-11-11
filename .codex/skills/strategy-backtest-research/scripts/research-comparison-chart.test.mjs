import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  generateResearchComparisonChart,
  renderResearchComparisonSvg,
  validateResearchComparisonSpec,
} from './research-comparison-chart.mjs';

const spec = () => ({
  schema: 'tradejs-research-comparison-chart/v1',
  title: 'Example 15m · сравнение AI-gates',
  subtitle: 'Одинаковое окно, риск и расходы',
  universeLabel: '530 USDT-контрактов Bybit',
  pnlUnit: 'USDT',
  window: { start: 1_000, end: 10_000, highlightStart: 8_000 },
  series: [
    {
      id: 'baseline',
      label: 'действующий AI-gate',
      role: 'baseline',
      trades: [
        [2_000, 5],
        [3_000, -2],
        [4_000, -3],
        [5_000, 4],
      ],
      metrics: { trades: 4, pnl: 4 },
    },
    {
      id: 'candidate',
      label: 'переобученный AI-gate',
      role: 'candidate',
      trades: [
        [2_500, 3],
        [3_500, -1],
        [4_500, 5],
      ],
      metrics: { trades: 3, pnl: 7 },
    },
  ],
});

test('derives cumulative pnl, drawdown, and losing streak from completed trades', () => {
  const validated = validateResearchComparisonSpec(spec());
  assert.deepEqual(validated.series[0].points, [
    [1_000, 0, 0, 0],
    [2_000, 5, 0, 0],
    [3_000, 3, 2, 1],
    [4_000, 0, 5, 2],
    [5_000, 4, 1, 0],
    [10_000, 4, 1, 0],
  ]);
});

test('renders the fixed three-panel format with explicit roles and metrics', () => {
  const svg = renderResearchComparisonSvg(spec());
  assert.match(svg, /Накопленный net PnL/);
  assert.match(svg, /Просадка от максимума net PnL/);
  assert.match(svg, /Последовательные убыточные сделки/);
  assert.match(svg, /BASELINE · действующий AI-gate/);
  assert.match(svg, /CANDIDATE · переобученный AI-gate/);
  assert.match(svg, /N=4 · PnL 4\.00 USDT/);
  assert.match(svg, /class="highlight"/);
});

test('supports retained cumulative equity while preserving explicit metric authority', () => {
  const input = spec();
  input.series[1] = {
    id: 'reference',
    label: 'сохранённый референс',
    role: 'reference',
    equity: [
      [2_500, 3],
      [3_500, 2],
      [4_500, 7],
    ],
    metrics: { trades: 3, pnl: 7 },
  };
  const validated = validateResearchComparisonSpec(input);
  assert.equal(
    validated.series[1].streakSemantics,
    'consecutive negative realized-equity steps',
  );
  assert.deepEqual(validated.series[1].points[1], [3_500, 2, 1, 1]);
});

test('distinguishes verified-empty equity from unavailable equity', () => {
  const input = spec();
  input.series[0] = {
    id: 'baseline',
    label: 'пустой baseline',
    role: 'baseline',
    equity: [],
    equityStatus: 'verified-empty',
    metrics: { trades: 0, pnl: 0 },
  };
  input.series[1] = {
    id: 'reference',
    label: 'кривая недоступна',
    role: 'reference',
    equity: [],
    equityStatus: 'unavailable',
    metrics: { trades: 3, pnl: 7 },
  };
  const svg = renderResearchComparisonSvg(input);
  assert.match(svg, /data-zero-guide="baseline"/);
  assert.match(svg, /equity unavailable \(UNKNOWN\)/);
  assert.doesNotMatch(svg, /data-series="reference"/);
});

test('rejects ambiguous charts without one explicit baseline', () => {
  const input = spec();
  input.series[0].role = 'reference';
  assert.throws(
    () => validateResearchComparisonSpec(input),
    /exactly one explicit baseline/,
  );
});

test('writes immutable SVG, PNG, and checksum summary', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'research-chart-'));
  const outBase = path.join(root, 'comparison');
  const result = await generateResearchComparisonChart({
    spec: spec(),
    outBase,
  });
  await access(result.svgPath);
  await access(result.pngPath);
  const { default: sharp } = await import('sharp');
  assert.equal((await sharp(result.pngPath).metadata()).width, 1_280);
  const summary = JSON.parse(await readFile(result.summaryPath, 'utf8'));
  assert.equal(summary.schema, 'tradejs-research-comparison-chart-summary/v1');
  assert.equal(summary.series[0].role, 'baseline');
  assert.equal(summary.rendering.metricsUseFullResolution, true);
  assert.ok(summary.artifacts['comparison.png']);
  await assert.rejects(
    generateResearchComparisonChart({ spec: spec(), outBase }),
    /EEXIST/,
  );
});
