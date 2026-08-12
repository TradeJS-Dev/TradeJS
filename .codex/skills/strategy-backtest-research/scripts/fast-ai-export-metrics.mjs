#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_PERIODS = [1100, 365, 180, 90, 30];
export const CORE_COHORT_ORDER = ['ALL', 'LONG', 'SHORT'];
const PNL_EPSILON = 1e-9;

const toFiniteNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeDirection = (value) => {
  const direction = String(value ?? '')
    .trim()
    .toUpperCase();
  return direction === 'LONG' || direction === 'SHORT' ? direction : 'UNKNOWN';
};

const normalizeConfigId = (value) => {
  const configId = String(value ?? '').trim();
  return configId || '<missing-config-id>';
};

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export const compareCompletedTrades = (left, right) =>
  left.exitTimestamp - right.exitTimestamp ||
  compareText(left.configId, right.configId) ||
  compareText(left.signalId, right.signalId) ||
  compareText(left.symbol, right.symbol) ||
  compareText(left.direction, right.direction) ||
  compareText(left.sourceFile, right.sourceFile) ||
  left.sourceLine - right.sourceLine;

const normalizeCompletedTrade = ({ filePath, lineNumber, row }) => {
  if (row?.tradeResult == null) return null;

  const netProfit = toFiniteNumber(row.tradeResult.netProfit);
  const exitTimestamp = toFiniteNumber(row.tradeResult.exitTimestamp);
  if (netProfit == null || exitTimestamp == null) {
    throw new Error(
      `${filePath}:${lineNumber} has tradeResult without finite netProfit/exitTimestamp`,
    );
  }

  return {
    backtestRunId:
      typeof row.backtestRunId === 'string' ? row.backtestRunId : null,
    configId: normalizeConfigId(row.configId),
    direction: normalizeDirection(row.direction ?? row.tradeResult.direction),
    exitTimestamp,
    netProfit,
    signalId: String(row.signalId ?? row.tradeResult.signalId ?? ''),
    sourceFile: filePath,
    sourceLine: lineNumber,
    symbol: String(row.symbol ?? ''),
  };
};

const tradeIdentity = (trade) =>
  [
    trade.backtestRunId ?? '',
    trade.configId,
    trade.signalId,
    trade.symbol,
  ].join(':');

const readOneExportFile = async ({ filePath, runId }) => {
  const resolvedPath = path.resolve(filePath);
  const input = createReadStream(resolvedPath, { encoding: 'utf8' });
  const sha256 = createHash('sha256');
  input.on('data', (chunk) => sha256.update(chunk));
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const trades = [];
  let rowsRead = 0;
  let blankLines = 0;
  let rowsWithoutTradeResult = 0;
  let rowsForDifferentRun = 0;

  for await (const line of lines) {
    const lineNumber = rowsRead + blankLines + 1;
    if (!line.trim()) {
      blankLines += 1;
      continue;
    }

    rowsRead += 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `${resolvedPath}:${lineNumber} contains invalid JSON: ${error.message}`,
      );
    }

    const trade = normalizeCompletedTrade({
      filePath: resolvedPath,
      lineNumber,
      row,
    });
    if (!trade) {
      rowsWithoutTradeResult += 1;
      continue;
    }
    if (runId && trade.backtestRunId !== runId) {
      rowsForDifferentRun += 1;
      continue;
    }
    trades.push(trade);
  }

  return {
    file: resolvedPath,
    sha256: sha256.digest('hex'),
    rowsRead,
    blankLines,
    rowsWithoutTradeResult,
    rowsForDifferentRun,
    selectedCompletedTrades: trades.length,
    trades,
  };
};

export const readExportFiles = async ({ filePaths, runId = null }) => {
  const fileReports = [];
  const trades = [];
  const identities = new Map();
  let duplicateRowsDropped = 0;

  for (const filePath of filePaths) {
    const fileReport = await readOneExportFile({ filePath, runId });
    const { trades: fileTrades, ...source } = fileReport;
    fileReports.push(source);

    for (const trade of fileTrades) {
      const identity = tradeIdentity(trade);
      const duplicate = identities.get(identity);
      if (duplicate) {
        if (
          duplicate.direction !== trade.direction ||
          duplicate.exitTimestamp !== trade.exitTimestamp ||
          duplicate.netProfit !== trade.netProfit
        ) {
          throw new Error(
            `Conflicting completed-trade rows share identity ${identity}`,
          );
        }
        duplicateRowsDropped += 1;
        continue;
      }
      identities.set(identity, trade);
      trades.push(trade);
    }
  }

  return {
    trades: trades.sort(compareCompletedTrades),
    scan: {
      files: fileReports,
      rowsRead: fileReports.reduce((sum, file) => sum + file.rowsRead, 0),
      rowsWithoutTradeResult: fileReports.reduce(
        (sum, file) => sum + file.rowsWithoutTradeResult,
        0,
      ),
      rowsForDifferentRun: fileReports.reduce(
        (sum, file) => sum + file.rowsForDifferentRun,
        0,
      ),
      selectedCompletedTradesBeforeDedup: fileReports.reduce(
        (sum, file) => sum + file.selectedCompletedTrades,
        0,
      ),
      duplicateRowsDropped,
      selectedCompletedTrades: trades.length,
    },
  };
};

const summarizeSelectedTrades = ({ trades, periodDays }) => {
  const sorted = [...trades].sort(compareCompletedTrades);
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let pnl = 0;
  let equity = 0;
  let peak = 0;
  let portfolioMaxDrawdown = 0;

  for (const trade of sorted) {
    const tradePnl = trade.netProfit;
    pnl += tradePnl;
    if (tradePnl > 0) {
      wins += 1;
      grossProfit += tradePnl;
    } else {
      losses += 1;
      if (tradePnl === 0) breakeven += 1;
      else grossLoss += Math.abs(tradePnl);
    }

    equity += tradePnl;
    peak = Math.max(peak, equity);
    portfolioMaxDrawdown = Math.max(portfolioMaxDrawdown, peak - equity);
  }

  const completedTrades = sorted.length;
  const profitFactorStatus =
    grossLoss > 0
      ? 'finite'
      : grossProfit > 0
        ? 'infinite_no_gross_loss'
        : 'undefined_no_gross_profit_or_loss';

  return {
    completedTrades,
    wins,
    losses,
    breakeven,
    winRatePct: completedTrades > 0 ? (wins / completedTrades) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    profitFactorStatus,
    pnl,
    pnlPerTrade: completedTrades > 0 ? pnl / completedTrades : null,
    portfolioMaxDrawdown,
    observedCadenceTradesPerDay:
      periodDays > 0 ? completedTrades / periodDays : null,
  };
};

export const summarizeTerminalWindow = ({
  trades,
  endTimestamp,
  periodDays,
  coverageStartTimestamp = null,
}) => {
  const startTimestamp = endTimestamp - periodDays * DAY_MS;
  const selected = trades.filter(
    (trade) =>
      trade.exitTimestamp >= startTimestamp &&
      trade.exitTimestamp < endTimestamp,
  );
  const byDirection = Object.fromEntries(
    ['LONG', 'SHORT'].map((direction) => [
      direction,
      summarizeSelectedTrades({
        trades: selected.filter((trade) => trade.direction === direction),
        periodDays,
      }),
    ]),
  );
  const unknownDirection = selected.filter(
    (trade) => trade.direction === 'UNKNOWN',
  );
  if (unknownDirection.length) {
    byDirection.UNKNOWN = summarizeSelectedTrades({
      trades: unknownDirection,
      periodDays,
    });
  }

  return {
    label: `${periodDays}d`,
    periodDays,
    startTimestamp,
    startIso: new Date(startTimestamp).toISOString(),
    endTimestamp,
    endIso: new Date(endTimestamp).toISOString(),
    interval: '[start, end)',
    coverage:
      coverageStartTimestamp == null
        ? 'unknown_without_run_manifest_start'
        : startTimestamp >= coverageStartTimestamp
          ? 'complete_within_run_manifest'
          : 'partial_before_run_manifest_start',
    metrics: summarizeSelectedTrades({ trades: selected, periodDays }),
    directions: byDirection,
  };
};

const aggregateRedisResults = (results) => {
  const aggregate = {
    resultCount: results.length,
    completedTrades: 0,
    wins: 0,
    losses: 0,
    pnl: 0,
  };

  for (const result of results) {
    const stat = result.stat;
    aggregate.completedTrades += toFiniteNumber(stat.orders) ?? 0;
    aggregate.wins += toFiniteNumber(stat.wins) ?? 0;
    aggregate.losses += toFiniteNumber(stat.losses) ?? 0;
    aggregate.pnl += toFiniteNumber(stat.netProfit ?? stat.profit) ?? 0;
  }
  return aggregate;
};

export const aggregateRedisResultStatsByConfig = (envelopes) => {
  const results = envelopes
    .map((entry) => entry?.result ?? entry)
    .filter((result) => result?.test && result?.stat);
  const grouped = new Map();
  for (const result of results) {
    const configId = normalizeConfigId(result.test.configId);
    const bucket = grouped.get(configId) ?? [];
    bucket.push(result);
    grouped.set(configId, bucket);
  }
  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([configId, configResults]) => [
        configId,
        aggregateRedisResults(configResults),
      ]),
  );
};

export const buildRedisReconciliation = ({ redisAggregate, exportMetrics }) => {
  if (!redisAggregate || redisAggregate.resultCount === 0) {
    return {
      source: 'redis-result-stat',
      status: 'unavailable',
      reason: 'No Redis checkpoint result.stat rows were found for the run.',
    };
  }

  const pnlTolerance = redisAggregate.resultCount * 0.005 + PNL_EPSILON;
  const delta = {
    completedTrades:
      exportMetrics.completedTrades - redisAggregate.completedTrades,
    wins: exportMetrics.wins - redisAggregate.wins,
    losses: exportMetrics.losses - redisAggregate.losses,
    pnl: exportMetrics.pnl - redisAggregate.pnl,
  };
  const matches = {
    completedTrades: delta.completedTrades === 0,
    wins: delta.wins === 0,
    losses: delta.losses === 0,
    pnl: Math.abs(delta.pnl) <= pnlTolerance,
  };

  return {
    source: 'redis-result-stat',
    status: Object.values(matches).every(Boolean) ? 'match' : 'mismatch',
    semantics:
      'Redis supplies aggregate N/W/L/PnL only; PF and aggregate portfolio MaxDD remain export-derived.',
    pnlTolerance,
    redis: redisAggregate,
    export: {
      completedTrades: exportMetrics.completedTrades,
      wins: exportMetrics.wins,
      losses: exportMetrics.losses,
      pnl: exportMetrics.pnl,
    },
    delta,
    matches,
  };
};

export const buildConfigExportReports = ({
  configIds,
  coverageStartTimestamp,
  endTimestamp,
  periods,
  redisAggregatesByConfig = {},
  fallbackRedisAggregate = null,
  runStartTimestamp = null,
  trades,
}) =>
  Object.fromEntries(
    configIds.map((configId) => {
      const configTrades = trades.filter(
        (trade) => trade.configId === configId,
      );
      const windows = periods.map((periodDays) =>
        summarizeTerminalWindow({
          trades: configTrades,
          endTimestamp,
          periodDays,
          coverageStartTimestamp,
        }),
      );
      const runWindowMetrics =
        runStartTimestamp == null
          ? null
          : summarizeSelectedTrades({
              trades: configTrades.filter(
                (trade) =>
                  trade.exitTimestamp >= runStartTimestamp &&
                  trade.exitTimestamp < endTimestamp,
              ),
              periodDays: (endTimestamp - runStartTimestamp) / DAY_MS,
            });
      const redisAggregate =
        redisAggregatesByConfig[configId] ??
        (configIds.length === 1 ? fallbackRedisAggregate : null);

      return [
        configId,
        {
          configId,
          completedTradesInFiles: configTrades.length,
          windows,
          runWindowMetrics,
          reconciliation:
            runWindowMetrics == null
              ? {
                  source: 'redis-result-stat',
                  status: 'not_requested',
                  reason:
                    'Pass --run to reconcile export N/W/L/PnL with Redis.',
                }
              : buildRedisReconciliation({
                  redisAggregate,
                  exportMetrics: runWindowMetrics,
                }),
        },
      ];
    }),
  );

const loadRunContextFromRedis = async ({ runId, userName }) => {
  const redis = await import('@tradejs/infra/redis');
  try {
    const [manifest, envelopes] = await Promise.all([
      redis.getData(redis.redisKeys.backtestRun(userName, runId), null),
      redis.getHashJsonValues(
        redis.redisKeys.backtestRunResults(userName, runId),
      ),
    ]);
    if (!manifest) {
      throw new Error(`No Redis backtest manifest found for run ${runId}`);
    }
    const startTimestamp = toFiniteNumber(manifest.window?.start);
    const endTimestamp = toFiniteNumber(manifest.window?.end);
    if (startTimestamp == null || endTimestamp == null) {
      throw new Error(`Redis manifest for run ${runId} has invalid window`);
    }

    return {
      manifest: {
        config: manifest.config ?? null,
        connectorName: manifest.connectorName ?? null,
        flags: manifest.flags ?? null,
        interval: manifest.interval ?? null,
        runId,
        startTimestamp,
        endTimestamp,
        status: manifest.status ?? null,
        configIds: [
          ...new Set(
            (Array.isArray(manifest.testSuite) ? manifest.testSuite : []).map(
              (test) => normalizeConfigId(test?.configId),
            ),
          ),
        ].sort(compareText),
        userName,
      },
      redisAggregatesByConfig: aggregateRedisResultStatsByConfig(envelopes),
    };
  } finally {
    await redis.closeRedisConnection();
  }
};

export const parseEndTimestamp = (value) => {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  const numeric = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(text);
  if (
    !Number.isFinite(timestamp) ||
    Number.isNaN(new Date(timestamp).getTime())
  ) {
    throw new Error(`Invalid --end value: ${value}`);
  }
  return timestamp;
};

const parsePeriods = (value) => {
  const periods = String(value ?? '')
    .split(',')
    .map((part) => Number(part.trim()));
  if (
    periods.length === 0 ||
    periods.some((period) => !Number.isInteger(period) || period <= 0)
  ) {
    throw new Error(
      '--periods must be a comma-separated list of positive days',
    );
  }
  return [...new Set(periods)];
};

export const parseArgs = (argv) => {
  const flags = {
    endTimestamp: null,
    filePaths: [],
    json: false,
    periods: DEFAULT_PERIODS,
    runId: null,
    userName: 'root',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      const filePath = argv[++index];
      if (!filePath) throw new Error('--file requires a JSONL path');
      flags.filePaths.push(filePath);
    } else if (arg === '--end') {
      flags.endTimestamp = parseEndTimestamp(argv[++index]);
    } else if (arg === '--run') {
      flags.runId = argv[++index] ?? null;
    } else if (arg === '--user') {
      flags.userName = argv[++index] ?? 'root';
    } else if (arg === '--periods') {
      flags.periods = parsePeriods(argv[++index]);
    } else if (arg === '--json') {
      flags.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!flags.filePaths.length || (!flags.runId && flags.endTimestamp == null)) {
    throw new Error(
      'Usage: fast-ai-export-metrics.mjs --file <export.jsonl> [--file <part.jsonl>] (--end <epoch-ms|ISO> | --run <run-id>) [--user root] [--periods 1100,365,180,90,30] [--json]',
    );
  }
  return flags;
};

export const buildExportReport = async ({
  endTimestamp: explicitEndTimestamp = null,
  filePaths,
  periods = DEFAULT_PERIODS,
  runId = null,
  userName = 'root',
  runContextLoader = loadRunContextFromRedis,
}) => {
  const runContext = runId ? await runContextLoader({ runId, userName }) : null;
  const manifestEndTimestamp = runContext?.manifest.endTimestamp ?? null;
  if (
    explicitEndTimestamp != null &&
    manifestEndTimestamp != null &&
    explicitEndTimestamp !== manifestEndTimestamp
  ) {
    throw new Error(
      `--end (${explicitEndTimestamp}) does not match Redis run manifest end (${manifestEndTimestamp})`,
    );
  }
  const endTimestamp = manifestEndTimestamp ?? explicitEndTimestamp;
  if (endTimestamp == null) {
    throw new Error('An explicit --end or a Redis --run manifest is required');
  }

  const { trades, scan } = await readExportFiles({ filePaths, runId });
  const coverageStartTimestamp = runContext?.manifest.startTimestamp ?? null;
  const configIds = [
    ...new Set([
      ...trades.map((trade) => trade.configId),
      ...(runContext?.manifest.configIds ?? []),
      ...Object.keys(runContext?.redisAggregatesByConfig ?? {}),
    ]),
  ].sort(compareText);
  const configReports = buildConfigExportReports({
    configIds,
    coverageStartTimestamp,
    endTimestamp,
    periods,
    redisAggregatesByConfig: runContext?.redisAggregatesByConfig ?? {},
    fallbackRedisAggregate: runContext?.redisAggregate ?? null,
    runStartTimestamp: runContext?.manifest.startTimestamp ?? null,
    trades,
  });
  const singleConfigReport =
    configIds.length === 1 ? configReports[configIds[0]] : null;
  const rowsAfterAnchor = trades.filter(
    (trade) => trade.exitTimestamp >= endTimestamp,
  ).length;
  const { files: fileReports, ...scanSummary } = scan;

  return {
    schemaVersion: 1,
    reportType: 'fast-ai-export-terminal-core-metrics',
    source: {
      kind: 'ai-export-jsonl-completed-trades',
      pnlField: 'tradeResult.netProfit',
      timestampField: 'tradeResult.exitTimestamp',
      gateDecisionsUsed: false,
      runFilterApplied: Boolean(runId),
      files: fileReports,
    },
    semantics: {
      cohortOrder: CORE_COHORT_ORDER,
      deterministicSort:
        'tradeResult.exitTimestamp, then signalId, symbol, direction, source file, source line',
      terminalWindow:
        '[manifestEnd - periodDays * 24h, manifestEnd), using UTC epoch milliseconds',
      cadence: 'completed trades / exact requested calendar days',
      deduplication:
        'exact duplicate run/config/signal/symbol identities are counted once; conflicting direction, exit timestamp, or outcome fails the report',
      loss: 'tradeResult.netProfit <= 0 (zero is a loss, matching Redis stat)',
      pnlPerTrade:
        'cohort total PnL / cohort completed trades; ALL uses aggregate PnL / aggregate N and is never an unweighted average of LONG/SHORT means',
      portfolioMaxDrawdown:
        'backward-compatible JSON field: metrics.portfolioMaxDrawdown is ALL aggregate portfolio realized MaxDD; directions.<side>.portfolioMaxDrawdown is side-only realized MaxDD after filtering to that direction; both use the chronological completed-trade net-PnL equity curve',
      profitFactor: 'gross positive PnL / absolute gross negative PnL',
    },
    metricSchema: {
      compatibility:
        'schemaVersion 1 field names are retained; scope is clarified additively',
      pnlPerTrade: {
        jsonField: 'pnlPerTrade',
        humanLabel: 'Avg PnL/trade (cohort PnL/N)',
        aggregateFormula: 'ALL.pnl / ALL.completedTrades',
        aggregateIsUnweightedAverageOfSideMeans: false,
      },
      realizedMaxDrawdown: {
        jsonField: 'portfolioMaxDrawdown',
        allScope: 'aggregate portfolio',
        longScope: 'side-only LONG',
        shortScope: 'side-only SHORT',
      },
    },
    anchor: {
      source: runContext ? 'redis-backtest-run-manifest' : 'explicit-end',
      runId,
      endTimestamp,
      endIso: new Date(endTimestamp).toISOString(),
      manifest: runContext?.manifest ?? null,
    },
    scan: {
      ...scanSummary,
      rowsAfterAnchor,
    },
    configIds,
    configReports,
    configAggregationWarning:
      configIds.length > 1
        ? `Multiple configId buckets found (${configIds.join(', ')}); top-level windows, runWindowMetrics, and reconciliation are null. Use configReports.`
        : null,
    windows: singleConfigReport?.windows ?? [],
    runWindowMetrics: singleConfigReport?.runWindowMetrics ?? null,
    reconciliation: singleConfigReport?.reconciliation ?? null,
  };
};

const formatNumber = (value, digits = 2) =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const formatProfitFactor = (metrics) => {
  if (metrics.profitFactor != null)
    return formatNumber(metrics.profitFactor, 3);
  return metrics.profitFactorStatus === 'infinite_no_gross_loss' ? '∞' : 'n/a';
};

const formatPercent = (value) =>
  value == null || !Number.isFinite(value) ? 'n/a' : `${formatNumber(value)}%`;

const reportCohorts = (window) => {
  const required = [
    ['ALL', window.metrics, 'aggregate portfolio'],
    ['LONG', window.directions.LONG, 'side-only LONG'],
    ['SHORT', window.directions.SHORT, 'side-only SHORT'],
  ];
  return window.directions.UNKNOWN
    ? [
        ...required,
        ['UNKNOWN', window.directions.UNKNOWN, 'direction-filtered diagnostic'],
      ]
    : required;
};

export const formatReport = (report) => {
  const rows = [
    '| Config | Period | Cohort | N | W | L | WR | PF | PnL | Avg PnL/trade (cohort PnL/N) | Realized MaxDD | MaxDD scope | Cadence/day | Coverage |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- |',
  ];
  for (const configReport of Object.values(report.configReports)) {
    for (const window of configReport.windows) {
      for (const [cohort, metrics, drawdownScope] of reportCohorts(window)) {
        rows.push(
          `| ${configReport.configId} | ${window.label} | ${cohort} | ${metrics.completedTrades} | ${metrics.wins} | ${metrics.losses} | ${formatPercent(metrics.winRatePct)} | ${formatProfitFactor(metrics)} | ${formatNumber(metrics.pnl)} | ${formatNumber(metrics.pnlPerTrade, 4)} | ${formatNumber(metrics.portfolioMaxDrawdown)} | ${drawdownScope} | ${formatNumber(metrics.observedCadenceTradesPerDay, 4)} | ${window.coverage} |`,
        );
      }
    }
  }

  const reconciliationLines = Object.values(report.configReports).map(
    ({ configId, reconciliation }) =>
      `Redis reconciliation [${configId}]: ${reconciliation.status}${reconciliation.status === 'match' || reconciliation.status === 'mismatch' ? `; ΔN=${reconciliation.delta.completedTrades}, ΔW=${reconciliation.delta.wins}, ΔL=${reconciliation.delta.losses}, ΔPnL=${formatNumber(reconciliation.delta.pnl, 4)}` : `; ${reconciliation.reason}`}`,
  );
  return [
    `source: ${report.source.kind} (${report.source.pnlField}, ${report.source.timestampField}; gate decisions used: no)`,
    `anchor: ${report.anchor.endIso} (${report.anchor.source}${report.anchor.runId ? `, run=${report.anchor.runId}` : ''})`,
    `rows: ${report.scan.selectedCompletedTrades} completed; filtered other run=${report.scan.rowsForDifferentRun}; missing tradeResult=${report.scan.rowsWithoutTradeResult}; duplicates dropped=${report.scan.duplicateRowsDropped}; after anchor=${report.scan.rowsAfterAnchor}`,
    `cohort order: ${CORE_COHORT_ORDER.join(' -> ')}`,
    'Avg PnL/trade: cohort total PnL / cohort N; ALL is aggregate PnL / aggregate N, never the unweighted average of LONG/SHORT means.',
    'Realized MaxDD: ALL uses the aggregate portfolio equity curve; LONG/SHORT use side-only time-ordered equity curves after direction filtering.',
    ...(report.configAggregationWarning
      ? [report.configAggregationWarning]
      : []),
    ...reconciliationLines,
    '',
    rows.join('\n'),
    '',
  ].join('\n');
};

const main = async () => {
  const flags = parseArgs(process.argv.slice(2));
  const report = await buildExportReport(flags);
  process.stdout.write(
    flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
  );
};

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
