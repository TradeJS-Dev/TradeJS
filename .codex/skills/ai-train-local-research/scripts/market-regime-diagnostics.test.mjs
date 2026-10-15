import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeRows,
  buildAblationReport,
  parseVariant,
  formatGateComparisonContract,
} from './ai-gate-ablation.mjs';

test('realized contract presentation keeps completed risk and decision fanout separate', () => {
  const variant = parseVariant('frozen::replace@4::true');
  const rows = [
    row(1, 1, 30, -3, 'bull'),
    row(2, 2, 20, 5, 'bull'),
    row(3, 3, 31, -2, 'bull'),
  ];
  rows.forEach((r) => {
    r.variantMatches = [true];
    r.quality = 4;
    r.directionMatches = true;
  });
  const d = buildAblationReport({
    rows,
    variants: [variant],
    minQuality: 4,
    qualityThresholds: [4, 5],
    terminalWindows: [180, 90, 30, 7],
    validationSplit: 0,
    testSplit: 0.4,
    windowStart: 0,
    windowEnd: 100,
    realizedMetrics: true,
    filePaths: ['fixture.jsonl'],
  });
  const text = formatGateComparisonContract({
    beforeReport: d,
    beforeVariant: 'frozen',
    afterReport: d,
    afterVariant: 'frozen',
    header: 'test',
    economicBasis: 'realized',
  });
  assert.match(
    text,
    /\| full \| before \| 3 \| 33.3% \| 1.00 \| 0.00 \| 0.00 \| 5.00 \| 2 \|/,
  );
  assert.match(text, /\| q4\+ total \| before \| 3 \| 3 \|/);
});
import {
  regimeBucket,
  buildMarketRegimeDiagnostics,
  validateRegimeStudy,
  savedSnapshotStatus,
} from './market-regime-diagnostics.mjs';

test('saved-snapshot audit separates null from zero without reconstructing the setup', () => {
  assert.equal(savedSnapshotStatus(null), 'null');
  assert.equal(savedSnapshotStatus(0), 'zero');
  const r = row(1, 1, 2, -3, 'bull');
  r.savedSnapshotFeatures = { 'setup.level': 0 };
  const d = build([r], {
    ...spec,
    snapshotAudits: [{ id: 'level', path: 'setup.level' }],
  });
  const b = d.streams[0].periods[0].snapshotAudits[0].buckets;
  assert.equal(b.find((x) => x.status === 'zero').metrics.completed.trades, 1);
  assert.equal(b.find((x) => x.status === 'null').metrics.completed.trades, 0);
});

test('causal candleQuality is allowed; outcome and gate-output segments are rejected', () => {
  const fixture = (path) => ({
    streams: [],
    periods: [],
    dimensions: [{ id: 'x', path, edges: [0.2] }],
  });
  assert.doesNotThrow(() =>
    validateRegimeStudy(
      fixture('baseContext.structure.candleQuality.rejectionWickScore'),
    ),
  );
  for (const path of [
    'baseContext.gateFeatures.rsi',
    'strategyGateFeatures.rsi',
    'outcome.profit',
    'quality',
    'provider.rows',
  ])
    assert.throws(() => validateRegimeStudy(fixture(path)), /signal-time/);
});

const row = (
  sequence,
  timestamp,
  exitTimestamp,
  netProfit,
  state,
  selected = true,
) => ({
  sequence,
  signalId: String(sequence),
  timestamp,
  direction: 'SHORT',
  symbol: 'X',
  profit: netProfit,
  features: { state },
  selected,
  completedTrade: {
    entryTimestamp: timestamp,
    exitTimestamp,
    netProfit,
    grossProfit: netProfit + 0.5,
    totalFee: 0.5,
    totalSlippageCost: 1,
    exitReason: netProfit > 0 ? 'take_profit' : 'stop_loss',
  },
});
const spec = {
  streams: ['frozen'],
  periods: [{ id: 'full', start: 0, end: 100 }],
  dimensions: [{ id: 'state', path: 'state', categories: ['bull', 'bear'] }],
};
const build = (rows, study = spec) =>
  buildMarketRegimeDiagnostics({
    rows,
    selectors: new Map([['frozen', (r) => r.selected]]),
    spec: study,
    summarizeRows,
  });

test('CLI report integration groups only final capacity-selected stream', () => {
  const variant = parseVariant('frozen::replace@4::true');
  variant.selection = {
    capacity: 1,
    rankBy: [{ path: 'margin', order: 'desc' }],
  };
  const rows = [row(1, 1, 20, -3, 'bull'), row(2, 1, 21, 5, 'bear')];
  rows.forEach((r, i) => {
    r.variantMatches = [true];
    r.features.margin = i;
    r.quality = 4;
    r.directionMatches = true;
  });
  const report = buildAblationReport({
    rows,
    variants: [variant],
    minQuality: 4,
    qualityThresholds: [4],
    terminalWindows: [7],
    validationSplit: 0,
    testSplit: 0.4,
    windowStart: 0,
    windowEnd: 100,
    realizedMetrics: true,
    filePaths: ['fixture.jsonl'],
    regimeStudy: spec,
  });
  assert.equal(report.variants[0].periods.full.trades, 1);
  const study = report.marketRegimeDiagnostics.streams[0];
  assert.equal(study.selected, 1);
  assert.equal(
    study.periods[0].dimensions[0].buckets.find((b) => b.bucket === 'bull')
      .metrics.completed.trades,
    0,
  );
  assert.equal(study.periods[0].metrics.completed.totalProfit, 5);
});

test('regime cohorts preserve previously frozen capacity identities and explicit missing', () => {
  const rows = [
    row(1, 1, 20, 5, 'bull'),
    row(2, 1, 21, -3, 'bear'),
    row(3, 1, 22, 99, 'bull', false),
    row(4, 2, 23, -2, null),
  ];
  const report = build(rows).streams[0].periods[0];
  assert.equal(report.metrics.completed.trades, 3);
  assert.equal(report.metrics.completed.totalProfit, 0);
  const buckets = report.dimensions[0].buckets;
  assert.equal(
    buckets.find((b) => b.bucket === 'bull').metrics.completed.trades,
    1,
  );
  assert.equal(
    buckets.find((b) => b.bucket === 'missing').metrics.completed.trades,
    1,
  );
  assert.equal(
    buckets.reduce((n, b) => n + b.metrics.completed.trades, 0),
    3,
  );
});

test('completed risk uses exits, fees reconcile and slippage is not subtracted twice', () => {
  const rows = [
    row(1, 1, 30, -3, 'bull'),
    row(2, 2, 20, 5, 'bull'),
    row(3, 3, 31, -2, 'bull'),
  ];
  const m = build(rows).streams[0].periods[0].metrics;
  assert.equal(m.decision.maxLossStreak, 1);
  assert.equal(m.completed.maxLossStreak, 2);
  assert.equal(m.completed.maxDrawdown, 5);
  assert.equal(m.costs.grossBeforeFees, 1.5);
  assert.equal(m.costs.fees, 1.5);
  assert.equal(m.costs.slippageEmbeddedInGross, 3);
  assert.equal(m.costs.reconciliation, 0);
});

test('numeric bin boundaries are half-open and null/string never becomes zero', () => {
  const d = { edges: [-2, 0, 2] };
  assert.equal(regimeBucket(-2, d), '[-2,0)');
  assert.equal(regimeBucket(0, d), '[0,2)');
  assert.equal(regimeBucket(2, d), '[2,+inf)');
  for (const v of [null, undefined, '0', NaN, Infinity])
    assert.equal(regimeBucket(v, d), 'missing');
  assert.throws(() => build([row(1, 20, 10, 1, 'bull')]), /valid trade/);
});

test('fixed period mean-change decomposition reconciles mix and within-regime change', () => {
  const study = {
    ...spec,
    periods: [
      { id: 'a', start: 0, end: 10 },
      { id: 'b', start: 10, end: 20 },
    ],
    comparePeriods: [['a', 'b']],
  };
  const rows = [
    row(1, 1, 2, 2, 'bull'),
    row(2, 3, 4, -2, 'bear'),
    row(3, 11, 12, 1, 'bull'),
    row(4, 13, 14, 1, 'bull'),
    row(5, 15, 16, -3, 'bear'),
  ];
  const d = build(rows, study).streams[0].decompositions[0].dimensions[0];
  assert.equal(d.complete, true);
  assert.ok(
    Math.abs(d.totalMeanChange - d.mixEffect - d.withinRegimeEffect) < 1e-12,
  );
});
