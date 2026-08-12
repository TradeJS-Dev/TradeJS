import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  aggregateRedisResultStatsByConfig,
  buildExportReport,
  buildRedisReconciliation,
  compareCompletedTrades,
  CORE_COHORT_ORDER,
  DEFAULT_PERIODS,
  formatReport,
  parseArgs,
  readExportFiles,
  summarizeTerminalWindow,
} from './fast-ai-export-metrics.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

const trade = ({
  configId = 'config-a',
  direction = 'LONG',
  exitTimestamp,
  netProfit,
  signalId,
  symbol = 'BTCUSDT',
}) => ({
  configId,
  direction,
  exitTimestamp,
  netProfit,
  signalId,
  sourceFile: 'fixture.jsonl',
  sourceLine: 1,
  symbol,
});

test('uses deterministic exit/signal/symbol ordering for portfolio MaxDD', () => {
  const endTimestamp = Date.UTC(2026, 7, 12);
  const trades = [
    trade({
      exitTimestamp: endTimestamp - DAY_MS,
      netProfit: -4,
      signalId: 'b',
      symbol: 'ETHUSDT',
    }),
    trade({
      exitTimestamp: endTimestamp - DAY_MS,
      netProfit: 5,
      signalId: 'a',
      symbol: 'BTCUSDT',
    }),
    trade({
      direction: 'SHORT',
      exitTimestamp: endTimestamp - 1,
      netProfit: -3,
      signalId: 'c',
    }),
  ];

  assert.deepEqual(
    [...trades].sort(compareCompletedTrades).map((item) => item.signalId),
    ['a', 'b', 'c'],
  );
  const window = summarizeTerminalWindow({
    trades,
    endTimestamp,
    periodDays: 30,
  });

  assert.equal(window.metrics.completedTrades, 3);
  assert.equal(window.metrics.wins, 1);
  assert.equal(window.metrics.losses, 2);
  assert.ok(Math.abs(window.metrics.winRatePct - 100 / 3) < 1e-12);
  assert.equal(window.metrics.profitFactor, 5 / 7);
  assert.equal(window.metrics.pnl, -2);
  assert.equal(window.metrics.pnlPerTrade, -2 / 3);
  assert.equal(window.metrics.portfolioMaxDrawdown, 7);
  assert.equal(window.metrics.observedCadenceTradesPerDay, 0.1);
  assert.equal(window.directions.LONG.completedTrades, 2);
  assert.equal(window.directions.SHORT.completedTrades, 1);
});

test('uses aggregate PnL/N and direction-filtered side-only drawdown', () => {
  const endTimestamp = Date.UTC(2026, 7, 12);
  const trades = [
    trade({
      direction: 'LONG',
      exitTimestamp: endTimestamp - 5,
      netProfit: 10,
      signalId: 'long-win',
    }),
    trade({
      direction: 'SHORT',
      exitTimestamp: endTimestamp - 4,
      netProfit: 100,
      signalId: 'short-win',
    }),
    trade({
      direction: 'LONG',
      exitTimestamp: endTimestamp - 3,
      netProfit: -6,
      signalId: 'long-loss',
    }),
    trade({
      direction: 'SHORT',
      exitTimestamp: endTimestamp - 2,
      netProfit: -30,
      signalId: 'short-loss-1',
    }),
    trade({
      direction: 'SHORT',
      exitTimestamp: endTimestamp - 1,
      netProfit: -10,
      signalId: 'short-loss-2',
    }),
  ];

  const window = summarizeTerminalWindow({
    trades,
    endTimestamp,
    periodDays: 30,
  });
  const unweightedAverageOfSideMeans =
    (window.directions.LONG.pnlPerTrade + window.directions.SHORT.pnlPerTrade) /
    2;

  assert.equal(window.metrics.completedTrades, 5);
  assert.equal(window.metrics.pnl, 64);
  assert.equal(window.metrics.pnlPerTrade, 64 / 5);
  assert.equal(window.directions.LONG.pnlPerTrade, 4 / 2);
  assert.equal(window.directions.SHORT.pnlPerTrade, 60 / 3);
  assert.notEqual(window.metrics.pnlPerTrade, unweightedAverageOfSideMeans);
  assert.equal(window.metrics.portfolioMaxDrawdown, 46);
  assert.equal(window.directions.LONG.portfolioMaxDrawdown, 6);
  assert.equal(window.directions.SHORT.portfolioMaxDrawdown, 40);
});

test('human report fixes cohort order and labels PnL/trade and drawdown scope', () => {
  const endTimestamp = Date.UTC(2026, 7, 12);
  const window = summarizeTerminalWindow({
    trades: [
      trade({
        direction: 'SHORT',
        exitTimestamp: endTimestamp - 2,
        netProfit: 2,
        signalId: 'short',
      }),
      trade({
        direction: 'LONG',
        exitTimestamp: endTimestamp - 1,
        netProfit: -1,
        signalId: 'long',
      }),
    ],
    endTimestamp,
    periodDays: 30,
  });
  const humanReport = formatReport({
    source: {
      kind: 'fixture',
      pnlField: 'tradeResult.netProfit',
      timestampField: 'tradeResult.exitTimestamp',
    },
    anchor: {
      endIso: new Date(endTimestamp).toISOString(),
      source: 'fixture',
      runId: null,
    },
    scan: {
      selectedCompletedTrades: 2,
      rowsForDifferentRun: 0,
      rowsWithoutTradeResult: 0,
      duplicateRowsDropped: 0,
      rowsAfterAnchor: 0,
    },
    configAggregationWarning: null,
    configReports: {
      'config-a': {
        configId: 'config-a',
        windows: [window],
        reconciliation: { status: 'unavailable', reason: 'fixture' },
      },
    },
  });

  assert.deepEqual(CORE_COHORT_ORDER, ['ALL', 'LONG', 'SHORT']);
  assert.match(humanReport, /Avg PnL\/trade \(cohort PnL\/N\)/);
  assert.match(humanReport, /ALL is aggregate PnL \/ aggregate N/);
  assert.match(humanReport, /aggregate portfolio equity curve/);
  assert.match(humanReport, /side-only time-ordered equity curves/);
  const allIndex = humanReport.indexOf('| config-a | 30d | ALL |');
  const longIndex = humanReport.indexOf('| config-a | 30d | LONG |');
  const shortIndex = humanReport.indexOf('| config-a | 30d | SHORT |');
  assert.ok(allIndex >= 0 && allIndex < longIndex && longIndex < shortIndex);
  assert.match(
    humanReport,
    /\| config-a \| 30d \| ALL \|.*\| aggregate portfolio \|/,
  );
  assert.match(
    humanReport,
    /\| config-a \| 30d \| LONG \|.*\| side-only LONG \|/,
  );
  assert.match(
    humanReport,
    /\| config-a \| 30d \| SHORT \|.*\| side-only SHORT \|/,
  );
});

test('anchors terminal windows strictly to the supplied end and exact days', () => {
  const endTimestamp = Date.UTC(2026, 7, 12);
  const window = summarizeTerminalWindow({
    trades: [
      trade({
        exitTimestamp: endTimestamp - 30 * DAY_MS,
        netProfit: 1,
        signalId: 'at-start',
      }),
      trade({
        exitTimestamp: endTimestamp,
        netProfit: 2,
        signalId: 'at-end',
      }),
      trade({
        exitTimestamp: endTimestamp - 1,
        netProfit: 2,
        signalId: 'before-end',
      }),
      trade({
        exitTimestamp: endTimestamp - 30 * DAY_MS - 1,
        netProfit: 100,
        signalId: 'before-start',
      }),
      trade({
        exitTimestamp: endTimestamp + 1,
        netProfit: 100,
        signalId: 'after-end',
      }),
    ],
    endTimestamp,
    periodDays: 30,
    coverageStartTimestamp: endTimestamp - 1100 * DAY_MS,
  });

  assert.equal(window.startTimestamp, endTimestamp - 30 * DAY_MS);
  assert.equal(window.endTimestamp, endTimestamp);
  assert.equal(window.metrics.completedTrades, 2);
  assert.equal(window.metrics.pnl, 3);
  assert.equal(window.metrics.observedCadenceTradesPerDay, 2 / 30);
  assert.equal(window.coverage, 'complete_within_run_manifest');
});

test('streams JSONL, filters the requested run, and drops duplicate trades', async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tradejs-fast-export-metrics-'),
  );
  const filePath = path.join(temporaryDirectory, 'export.jsonl');
  const completedRow = {
    backtestRunId: 'run-a',
    direction: 'LONG',
    signalId: 'signal-1',
    symbol: 'BTCUSDT',
    tradeResult: { exitTimestamp: 100, netProfit: 3 },
  };

  try {
    await fs.writeFile(
      filePath,
      [
        JSON.stringify(completedRow),
        JSON.stringify(completedRow),
        JSON.stringify({ ...completedRow, backtestRunId: 'run-b' }),
        JSON.stringify({ backtestRunId: 'run-a', signalId: 'open' }),
        '',
      ].join('\n'),
    );

    const result = await readExportFiles({
      filePaths: [filePath],
      runId: 'run-a',
    });

    assert.equal(result.scan.rowsRead, 4);
    assert.equal(result.scan.rowsForDifferentRun, 1);
    assert.equal(result.scan.rowsWithoutTradeResult, 1);
    assert.equal(result.scan.selectedCompletedTradesBeforeDedup, 2);
    assert.equal(result.scan.duplicateRowsDropped, 1);
    assert.equal(result.scan.selectedCompletedTrades, 1);
    assert.equal(result.trades[0].netProfit, 3);
    assert.match(result.scan.files[0].sha256, /^[a-f0-9]{64}$/);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('rejects conflicting outcomes for the same run/config/signal/symbol identity', async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tradejs-fast-export-conflict-'),
  );
  const filePath = path.join(temporaryDirectory, 'export.jsonl');
  const baseRow = {
    backtestRunId: 'run-a',
    configId: 'config-a',
    direction: 'LONG',
    signalId: 'signal-1',
    symbol: 'BTCUSDT',
  };

  try {
    await fs.writeFile(
      filePath,
      [
        JSON.stringify({
          ...baseRow,
          tradeResult: { exitTimestamp: 100, netProfit: 3 },
        }),
        JSON.stringify({
          ...baseRow,
          tradeResult: { exitTimestamp: 200, netProfit: 4 },
        }),
      ].join('\n'),
    );

    await assert.rejects(
      readExportFiles({ filePaths: [filePath], runId: 'run-a' }),
      /Conflicting completed-trade rows share identity/,
    );
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('reconciles export trade metrics with Redis stat aggregates', () => {
  const reconciliation = buildRedisReconciliation({
    redisAggregate: {
      resultCount: 2,
      completedTrades: 3,
      wins: 1,
      losses: 2,
      pnl: 1.004,
    },
    exportMetrics: {
      completedTrades: 3,
      wins: 1,
      losses: 2,
      pnl: 1,
    },
  });

  assert.equal(reconciliation.status, 'match');
  assert.ok(Math.abs(reconciliation.delta.pnl + 0.004) < 1e-12);
  assert.equal(reconciliation.matches.pnl, true);
  assert.match(reconciliation.semantics, /PF and aggregate portfolio MaxDD/);
});

test('aggregates Redis result stats independently by result configId', () => {
  const summaries = aggregateRedisResultStatsByConfig([
    {
      result: {
        test: { configId: 'config-a' },
        stat: { orders: 2, wins: 1, losses: 1, netProfit: 3 },
      },
    },
    {
      result: {
        test: { configId: 'config-b' },
        stat: { orders: 5, wins: 2, losses: 3, netProfit: -7 },
      },
    },
    {
      result: {
        test: { configId: 'config-a' },
        stat: { orders: 1, wins: 1, losses: 0, profit: 2 },
      },
    },
  ]);

  assert.deepEqual(summaries, {
    'config-a': {
      resultCount: 2,
      completedTrades: 3,
      wins: 2,
      losses: 1,
      pnl: 5,
    },
    'config-b': {
      resultCount: 1,
      completedTrades: 5,
      wins: 2,
      losses: 3,
      pnl: -7,
    },
  });
});

test('builds all default windows from the Redis manifest end, not export max', async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tradejs-fast-export-report-'),
  );
  const filePath = path.join(temporaryDirectory, 'export.jsonl');
  const endTimestamp = Date.UTC(2026, 7, 12);

  try {
    await fs.writeFile(
      filePath,
      `${JSON.stringify({
        backtestRunId: 'run-a',
        direction: 'SHORT',
        signalId: 'future',
        symbol: 'ETHUSDT',
        tradeResult: { exitTimestamp: endTimestamp + DAY_MS, netProfit: 10 },
      })}\n`,
    );
    const report = await buildExportReport({
      filePaths: [filePath],
      periods: DEFAULT_PERIODS,
      runId: 'run-a',
      runContextLoader: async () => ({
        manifest: {
          runId: 'run-a',
          startTimestamp: endTimestamp - 1100 * DAY_MS,
          endTimestamp,
        },
        redisAggregate: {
          resultCount: 1,
          completedTrades: 0,
          wins: 0,
          losses: 0,
          pnl: 0,
        },
      }),
    });

    assert.deepEqual(
      report.windows.map((window) => window.periodDays),
      DEFAULT_PERIODS,
    );
    assert.equal(report.anchor.endTimestamp, endTimestamp);
    assert.equal(report.scan.rowsAfterAnchor, 1);
    assert.equal(report.windows[0].metrics.completedTrades, 0);
    assert.equal(report.source.gateDecisionsUsed, false);
    assert.equal(report.reconciliation.status, 'match');
    assert.deepEqual(report.semantics.cohortOrder, CORE_COHORT_ORDER);
    assert.match(report.semantics.pnlPerTrade, /never an unweighted average/);
    assert.equal(
      report.metricSchema.realizedMaxDrawdown.jsonField,
      'portfolioMaxDrawdown',
    );
    assert.match(report.metricSchema.compatibility, /schemaVersion 1/);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('keeps export windows and Redis reconciliation separate for grid configs', async () => {
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'tradejs-fast-export-grid-report-'),
  );
  const filePath = path.join(temporaryDirectory, 'export.jsonl');
  const endTimestamp = Date.UTC(2026, 7, 12);

  try {
    await fs.writeFile(
      filePath,
      [
        {
          backtestRunId: 'run-grid',
          configId: 'config-a',
          direction: 'LONG',
          signalId: 'same-signal',
          symbol: 'BTCUSDT',
          tradeResult: { exitTimestamp: endTimestamp - 1, netProfit: 4 },
        },
        {
          backtestRunId: 'run-grid',
          configId: 'config-b',
          direction: 'SHORT',
          signalId: 'same-signal',
          symbol: 'BTCUSDT',
          tradeResult: { exitTimestamp: endTimestamp - 1, netProfit: -9 },
        },
      ]
        .map(JSON.stringify)
        .join('\n'),
    );
    const report = await buildExportReport({
      filePaths: [filePath],
      periods: [30],
      runId: 'run-grid',
      runContextLoader: async () => ({
        manifest: {
          runId: 'run-grid',
          startTimestamp: endTimestamp - 30 * DAY_MS,
          endTimestamp,
          configIds: ['config-a', 'config-b'],
        },
        redisAggregatesByConfig: {
          'config-a': {
            resultCount: 1,
            completedTrades: 1,
            wins: 1,
            losses: 0,
            pnl: 4,
          },
          'config-b': {
            resultCount: 1,
            completedTrades: 1,
            wins: 0,
            losses: 1,
            pnl: -9,
          },
        },
      }),
    });

    assert.deepEqual(report.configIds, ['config-a', 'config-b']);
    assert.equal(report.scan.selectedCompletedTrades, 2);
    assert.equal(report.scan.duplicateRowsDropped, 0);
    assert.deepEqual(report.windows, []);
    assert.equal(report.runWindowMetrics, null);
    assert.equal(report.reconciliation, null);
    assert.equal(report.configReports['config-a'].windows[0].metrics.pnl, 4);
    assert.equal(report.configReports['config-b'].windows[0].metrics.pnl, -9);
    assert.equal(
      report.configReports['config-a'].reconciliation.status,
      'match',
    );
    assert.equal(
      report.configReports['config-b'].reconciliation.status,
      'match',
    );
    assert.match(report.configAggregationWarning, /Multiple configId buckets/);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('parses repeated files and the requested default metric periods', () => {
  const flags = parseArgs([
    '--file',
    'part1.jsonl',
    '--file',
    'part2.jsonl',
    '--end',
    '2026-08-12T00:00:00.000Z',
  ]);

  assert.deepEqual(flags.filePaths, ['part1.jsonl', 'part2.jsonl']);
  assert.deepEqual(flags.periods, DEFAULT_PERIODS);
  assert.equal(flags.endTimestamp, Date.UTC(2026, 7, 12));
});
