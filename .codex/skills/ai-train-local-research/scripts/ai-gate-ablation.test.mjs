import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAblationReport,
  evaluateRule,
  formatMarkdownReport,
  isVariantSelected,
  parseCliArgs,
  parseRuleExpression,
  parseVariant,
  summarizeRows,
} from './ai-gate-ablation.mjs';

test('parses repeated variants and research windows', () => {
  const options = parseCliArgs([
    '--strategy',
    'LiquidityTails',
    '--variant',
    'near-ma::filter::trend.distance <= 1.2',
    '--variant=zones::exclude::structure.activeCount == 0',
    '--terminalWindows=180,90,30,7',
    '--qualityThresholds',
    '4,5',
  ]);

  assert.equal(options.strategy, 'LiquidityTails');
  assert.deepEqual(options.variants, [
    'near-ma::filter::trend.distance <= 1.2',
    'zones::exclude::structure.activeCount == 0',
  ]);
  assert.deepEqual(options.terminalWindows, [180, 90, 30, 7]);
  assert.deepEqual(options.qualityThresholds, [4, 5]);
});

test('evaluates numeric, string, boolean, and null predicates with precedence', () => {
  const rule = parseRuleExpression(
    '(trend.distance <= 1.2 && structure.zone == active) || flags.recovery == true',
  );

  assert.equal(
    evaluateRule(rule, {
      'trend.distance': 1.1,
      'structure.zone': 'active',
      'flags.recovery': false,
    }),
    true,
  );
  assert.equal(
    evaluateRule(rule, {
      'trend.distance': 1.3,
      'structure.zone': 'active',
      'flags.recovery': true,
    }),
    true,
  );
  assert.equal(
    evaluateRule(parseRuleExpression('feature.value == null'), {
      'feature.value': null,
    }),
    true,
  );
  assert.equal(evaluateRule(rule, {}), false);
});

test('parses variant mode and optional assigned quality', () => {
  const variant = parseVariant(
    'q3-recovery::add@4::context.bodyStrength >= 0.65',
  );

  assert.equal(variant.name, 'q3-recovery');
  assert.equal(variant.mode, 'add');
  assert.equal(variant.quality, 4);
  assert.throws(
    () => parseVariant('invalid::add@6::context.value == true'),
    /Invalid added quality/,
  );
});

test('applies filter, exclude, add, and replace selection semantics', () => {
  const selected = (mode, baselineSelected, matches, quality = null) =>
    isVariantSelected({
      variant: { mode, quality },
      baselineSelected,
      matches,
      threshold: 4,
      defaultQuality: 4,
    });

  assert.equal(selected('filter', true, true), true);
  assert.equal(selected('filter', true, false), false);
  assert.equal(selected('exclude', true, true), false);
  assert.equal(selected('exclude', true, false), true);
  assert.equal(selected('add', false, true), true);
  assert.equal(selected('add', false, true, 3), false);
  assert.equal(selected('replace', true, false), false);
  assert.equal(selected('replace', false, true), true);
});

test('calculates required profit, drawdown, strict-loss, and cadence metrics', () => {
  const rows = [
    {
      timestamp: Date.UTC(2026, 0, 1),
      profit: 10,
      symbol: 'A',
      direction: 'LONG',
    },
    {
      timestamp: Date.UTC(2026, 0, 2),
      profit: -4,
      symbol: 'B',
      direction: 'SHORT',
    },
    {
      timestamp: Date.UTC(2026, 0, 3),
      profit: -7,
      symbol: 'A',
      direction: 'LONG',
    },
    {
      timestamp: Date.UTC(2026, 1, 1),
      profit: 5,
      symbol: 'A',
      direction: 'LONG',
    },
  ];
  const summary = summarizeRows(rows, 31);

  assert.equal(summary.trades, 4);
  assert.equal(summary.totalProfit, 4);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.profitFactor, 15 / 11);
  assert.equal(typeof summary.sharpeRatio, 'number');
  assert.equal(typeof summary.sortinoRatio, 'number');
  assert.equal(summary.calmarRatio, (4 / 31) * 365 / 11);
  assert.equal(summary.maxDrawdown, 11);
  assert.equal(summary.largestLoss, -7);
  assert.equal(summary.maxLossStreak, 2);
  assert.equal(summary.losingMonths, 1);
  assert.deepEqual(summary.losingMonthValues, [{ month: '2026-01', pnl: -1 }]);
  assert.equal(summary.cadencePerDay, 4 / 31);
  assert.equal(summary.cadencePerWeek, (4 / 31) * 7);
  assert.equal(summary.averageProfitPerMonth, (4 / 31) * 30.4375);
});

test('builds full and terminal period comparisons for a candidate', () => {
  const start = Date.UTC(2025, 0, 1);
  const variants = [parseVariant('keep::filter::feature.keep == true')];
  const rows = [
    {
      timestamp: start,
      profit: 10,
      symbol: 'A',
      direction: 'LONG',
      directionMatches: true,
      quality: 4,
      variantMatches: [true],
    },
    {
      timestamp: start + 200 * 24 * 60 * 60 * 1000,
      profit: -5,
      symbol: 'B',
      direction: 'SHORT',
      directionMatches: true,
      quality: 5,
      variantMatches: [false],
    },
  ];
  const report = buildAblationReport({
    rows,
    variants,
    minQuality: 4,
    qualityThresholds: [4, 5],
    terminalWindows: [180, 90, 30, 7],
    validationSplit: 0.25,
    filePaths: ['part1.jsonl'],
  });

  assert.deepEqual(Object.keys(report.baseline.periods), [
    'full',
    '180d',
    '90d',
    '30d',
    '7d',
  ]);
  assert.equal(report.baseline.periods.full.trades, 2);
  assert.equal(report.variants[0].periods.full.trades, 1);
  assert.equal(report.variants[0].removed.trades, 1);
  assert.match(formatMarkdownReport(report), /## Baseline/);
  assert.match(formatMarkdownReport(report), /## Variant: keep/);
});
