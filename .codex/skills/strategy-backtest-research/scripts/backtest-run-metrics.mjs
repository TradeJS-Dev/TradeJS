#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateAdvancedTradeMetrics } from '@tradejs/core/backtest';
import {
  closeRedisConnection,
  getData,
  getHashJsonValues,
  redisKeys,
} from '@tradejs/infra/redis';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIODS = [365, 180, 90, 30, 7];
const ARTIFACT_READ_CONCURRENCY = 8;
const WORST_SYMBOL_DRAWDOWN_WARNING =
  'worstSymbolMaxDrawdownPct is the maximum stat.maxDrawdown across individual results/symbols; it is not portfolio MaxDD.';

const resolveProjectRoot = () =>
  path.resolve(String(process.env.PROJECT_CWD || process.cwd()));

const readCachedOrderLog = async ({ orderLogId, userName }) => {
  const filePath = path.join(
    resolveProjectRoot(),
    'data',
    'backtests',
    'cache',
    encodeURIComponent(userName),
    'orders',
    `${encodeURIComponent(orderLogId)}.json`,
  );
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const toFiniteNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeExitReason = (type) => {
  const normalized = String(type ?? '').toUpperCase();
  if (normalized.startsWith('TAKE_PROFIT')) return 'take_profit';
  if (normalized.startsWith('STOP_LOSS')) return 'stop_loss';
  return 'exit';
};

const isOpenOrder = (order) =>
  String(order?.type ?? '')
    .toUpperCase()
    .startsWith('OPEN_');

const isExitOrder = (order) => {
  const type = String(order?.type ?? '').toUpperCase();
  return (
    type.startsWith('TAKE_PROFIT') ||
    type.startsWith('STOP_LOSS') ||
    type.startsWith('CLOSE_') ||
    type.startsWith('EXIT_') ||
    type.startsWith('LIQUIDATION')
  );
};

const isTerminalExitOrder = (order) => {
  const type = String(order?.type ?? '').toUpperCase();
  return (
    type.startsWith('STOP_LOSS') ||
    type.startsWith('CLOSE_') ||
    type.startsWith('EXIT_') ||
    type.startsWith('LIQUIDATION')
  );
};

export const reconstructTrades = (orderLogs) => {
  const trades = [];
  const increaseEvents = [];
  let incompleteCycles = 0;

  for (const orders of orderLogs) {
    let cycle = null;
    const sorted = [...orders].sort(
      (a, b) => toFiniteNumber(a.timestamp) - toFiniteNumber(b.timestamp),
    );

    for (const order of sorted) {
      const profit = toFiniteNumber(order.profit);

      if (isOpenOrder(order)) {
        if (order.positionIntent === 'increase') {
          if (!cycle) continue;
          cycle.pnl += profit;
          cycle.increases += 1;
          const increaseQty = toFiniteNumber(order.qty, Number.NaN);
          cycle.remainingQty =
            cycle.remainingQty != null &&
            Number.isFinite(increaseQty) &&
            increaseQty > 0
              ? cycle.remainingQty + increaseQty
              : null;
          increaseEvents.push({
            timestamp: toFiniteNumber(order.timestamp),
            symbol: cycle.symbol,
            level: cycle.increases + 1,
          });
          continue;
        }

        if (cycle) incompleteCycles += 1;
        cycle = {
          id: String(order.orderId ?? `${order.symbol}:${order.timestamp}`),
          timestamp: toFiniteNumber(order.timestamp),
          pnl: profit,
          symbol: order.symbol ?? null,
          direction: order.direction ?? null,
          increases: 0,
          remainingQty: (() => {
            const qty = toFiniteNumber(order.qty, Number.NaN);
            return Number.isFinite(qty) && qty > 0 ? qty : null;
          })(),
        };
        continue;
      }

      if (!cycle) continue;
      cycle.pnl += profit;
      if (!isExitOrder(order)) continue;

      const exitQty = toFiniteNumber(order.qty, Number.NaN);
      if (
        cycle.remainingQty != null &&
        Number.isFinite(exitQty) &&
        exitQty > 0
      ) {
        cycle.remainingQty = Math.max(0, cycle.remainingQty - exitQty);
      } else {
        cycle.remainingQty = null;
      }
      const positionClosed =
        isTerminalExitOrder(order) ||
        cycle.remainingQty == null ||
        cycle.remainingQty <= 1e-10;
      if (!positionClosed) continue;

      trades.push({
        id: cycle.id,
        timestamp: toFiniteNumber(order.timestamp),
        pnl: cycle.pnl,
        symbol: cycle.symbol,
        direction: cycle.direction,
        exitReason: normalizeExitReason(order.type),
        increases: cycle.increases,
      });
      cycle = null;
    }

    if (cycle) incompleteCycles += 1;
  }

  return {
    trades: trades.sort((a, b) => a.timestamp - b.timestamp),
    increaseEvents: increaseEvents.sort((a, b) => a.timestamp - b.timestamp),
    incompleteCycles,
  };
};

const getLosingMonths = (trades) => {
  const monthly = new Map();
  for (const trade of trades) {
    const date = new Date(trade.timestamp);
    const key = `${date.getUTCFullYear()}-${String(
      date.getUTCMonth() + 1,
    ).padStart(2, '0')}`;
    monthly.set(key, (monthly.get(key) ?? 0) + trade.pnl);
  }

  return [...monthly.entries()]
    .filter(([, pnl]) => pnl < 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnl]) => ({ month, pnl }));
};

export const summarizeTradeWindow = ({
  trades,
  increaseEvents,
  startTimestamp,
  endTimestamp,
}) => {
  const selectedTrades = trades.filter(
    (trade) =>
      trade.timestamp >= startTimestamp && trade.timestamp <= endTimestamp,
  );
  const selectedIncreases = increaseEvents.filter(
    (event) =>
      event.timestamp >= startTimestamp && event.timestamp <= endTimestamp,
  );
  const metrics = calculateAdvancedTradeMetrics({
    trades: selectedTrades,
    startTimestamp,
    endTimestamp,
  });
  const levelCounts = Object.fromEntries(
    [2, 3, 4].map((level) => [
      level,
      selectedIncreases.filter((event) => event.level === level).length,
    ]),
  );

  return {
    ...metrics,
    increases: {
      total: selectedIncreases.length,
      levels: levelCounts,
      tradesWithIncrease: selectedTrades.filter((trade) => trade.increases > 0)
        .length,
    },
    losingMonthValues: getLosingMonths(selectedTrades),
  };
};

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

export const summarizeResultStats = ({
  results,
  startTimestamp,
  endTimestamp,
  projectedUniverse = null,
}) => {
  const resultCount = results.length;
  const windowDays = (endTimestamp - startTimestamp) / DAY_MS;
  let netProfit = 0;
  let orders = 0;
  let wins = 0;
  let losses = 0;
  let worstSymbolMaxDrawdownPct = null;

  for (const result of results) {
    const stat = result?.stat ?? {};
    netProfit += toFiniteNumber(stat.netProfit ?? stat.profit);
    orders += toFiniteNumber(stat.orders);
    wins += toFiniteNumber(stat.wins);
    losses += toFiniteNumber(stat.losses);

    const maxDrawdown = toFiniteNumber(stat.maxDrawdown, Number.NaN);
    if (Number.isFinite(maxDrawdown)) {
      worstSymbolMaxDrawdownPct = Math.max(
        worstSymbolMaxDrawdownPct ?? Number.NEGATIVE_INFINITY,
        maxDrawdown,
      );
    }
  }

  const closedOutcomes = wins + losses;
  const observedCadenceTradesPerDay =
    windowDays > 0 ? orders / windowDays : null;
  const projectedCadence =
    projectedUniverse != null &&
    resultCount > 0 &&
    observedCadenceTradesPerDay != null
      ? {
          label: `projected cadence for ${projectedUniverse} results`,
          projectedUniverse,
          actualResultCount: resultCount,
          scaleFactor: projectedUniverse / resultCount,
          tradesPerDay:
            observedCadenceTradesPerDay * (projectedUniverse / resultCount),
        }
      : null;

  return {
    source: 'redis-result-stat',
    authoritativeAggregate: true,
    resultCount,
    startTimestamp,
    endTimestamp,
    windowDays,
    netProfit,
    orders,
    wins,
    losses,
    winRatePct: closedOutcomes > 0 ? (wins / closedOutcomes) * 100 : null,
    pnlPerTrade: orders > 0 ? netProfit / orders : null,
    observedCadenceTradesPerDay,
    projectedCadence,
    worstSymbolMaxDrawdownPct,
    warnings: [WORST_SYMBOL_DRAWDOWN_WARNING],
  };
};

const normalizeConfigId = (test) => {
  const configId = String(test?.configId ?? '').trim();
  return configId || '<missing-config-id>';
};

const uniqueSymbolCount = (tests) =>
  new Set(
    tests.map((test) => String(test?.symbol ?? '').trim()).filter(Boolean),
  ).size;

export const buildConfigStatSummaries = ({
  results,
  manifest,
  startTimestamp,
  endTimestamp,
  projectedUniverse = null,
}) => {
  const plannedTests = Array.isArray(manifest?.testSuite)
    ? manifest.testSuite
    : [];
  const resultsByConfig = new Map();
  const plannedByConfig = new Map();

  for (const test of plannedTests) {
    const configId = normalizeConfigId(test);
    const bucket = plannedByConfig.get(configId) ?? [];
    bucket.push(test);
    plannedByConfig.set(configId, bucket);
  }
  for (const result of results) {
    const configId = normalizeConfigId(result?.test);
    const bucket = resultsByConfig.get(configId) ?? [];
    bucket.push(result);
    resultsByConfig.set(configId, bucket);
  }

  const configIds = [
    ...new Set([...plannedByConfig.keys(), ...resultsByConfig.keys()]),
  ].sort((left, right) => left.localeCompare(right));
  const manifestStatus = String(manifest?.status ?? 'missing');
  const statSummariesByConfig = Object.fromEntries(
    configIds.map((configId) => {
      const configResults = resultsByConfig.get(configId) ?? [];
      const configPlannedTests = plannedByConfig.get(configId) ?? [];
      const planned = configPlannedTests.length;
      const completed = configResults.length;
      const missing = Math.max(0, planned - completed);
      const extra = Math.max(0, completed - planned);
      const authoritativeAggregate =
        planned > 0 && completed === planned && manifestStatus === 'completed';
      const completionWarning = authoritativeAggregate
        ? null
        : `Config ${configId} is not an authoritative complete aggregate: manifest status=${manifestStatus}, completed=${completed}, planned=${planned}.`;
      const errorPersistenceWarning =
        'Worker error counts are not persisted in the backtest run manifest; inspect the terminal/report log for actual worker errors.';
      const summary = summarizeResultStats({
        results: configResults,
        startTimestamp,
        endTimestamp,
        projectedUniverse,
      });

      return [
        configId,
        {
          ...summary,
          configId,
          authoritativeAggregate,
          completion: {
            status: authoritativeAggregate ? 'complete' : 'partial',
            manifestStatus,
            planned,
            completed,
            missing,
            extra,
            plannedSymbols: uniqueSymbolCount(configPlannedTests),
            completedSymbols: uniqueSymbolCount(
              configResults.map((result) => result.test),
            ),
            errors: null,
            errorStatus: 'not_persisted',
          },
          warnings: [
            ...summary.warnings,
            errorPersistenceWarning,
            ...(completionWarning ? [completionWarning] : []),
          ],
        },
      ];
    }),
  );
  const multipleConfigsWarning =
    configIds.length > 1
      ? `Run contains multiple configId buckets (${configIds.join(', ')}); top-level statSummary is null and config metrics are reported separately.`
      : null;

  return {
    configIds,
    statSummary:
      configIds.length === 1 ? statSummariesByConfig[configIds[0]] : null,
    statSummariesByConfig,
    warnings: multipleConfigsWarning ? [multipleConfigsWarning] : [],
  };
};

const parseArgs = (argv) => {
  const parsed = {
    runId: null,
    userName: 'root',
    periods: DEFAULT_PERIODS,
    projectedUniverse: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run') parsed.runId = argv[++index] ?? null;
    else if (arg === '--user') parsed.userName = argv[++index] ?? 'root';
    else if (arg === '--periods') {
      parsed.periods = String(argv[++index] ?? '')
        .split(',')
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);
    } else if (arg === '--projected-universe') {
      const projectedUniverse = Number(argv[++index] ?? '');
      if (!Number.isInteger(projectedUniverse) || projectedUniverse <= 0) {
        throw new Error('--projected-universe must be a positive integer');
      }
      parsed.projectedUniverse = projectedUniverse;
    } else if (arg === '--json') parsed.json = true;
  }

  if (!parsed.runId) {
    throw new Error('Usage: backtest-run-metrics.mjs --run <run-id>');
  }
  return parsed;
};

const formatNumber = (value, digits = 2) =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const formatSummaryTable = (report) => {
  const rows = [
    '| Period | Trades | WR | PF | PnL | MaxDD | Strict loss | Loss streak | Losing months | Trades/day | L2/L3/L4 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const period of report.periods) {
    const { core, risk, distribution, increases } = period.metrics;
    rows.push(
      `| ${period.label} | ${core.trades} | ${formatNumber(core.winRate)}% | ${formatNumber(core.profitFactor, 3)} | ${formatNumber(core.totalPnl)} | ${formatNumber(risk.maxDrawdown)} | ${formatNumber(distribution.largestLoss)} | ${risk.maxLossStreak} | ${risk.losingMonthsCount} | ${formatNumber(core.tradesPerDay)} | ${increases.levels[2]}/${increases.levels[3]}/${increases.levels[4]} |`,
    );
  }

  return rows.join('\n');
};

const formatStatSummary = (statSummary) => {
  const projected = statSummary.projectedCadence
    ? `${formatNumber(statSummary.projectedCadence.tradesPerDay)} trades/day (${statSummary.projectedCadence.label}; scale=${formatNumber(statSummary.projectedCadence.scaleFactor, 4)})`
    : 'not requested';

  return [
    `Redis result.stat aggregate for config ${statSummary.configId ?? '<unknown>'} (${statSummary.authoritativeAggregate ? 'authoritative' : 'partial'}, including --fast runs):`,
    ...(statSummary.completion
      ? [
          `completion: ${statSummary.completion.completed}/${statSummary.completion.planned} tests; missing=${statSummary.completion.missing}; symbols=${statSummary.completion.completedSymbols}/${statSummary.completion.plannedSymbols}; manifest=${statSummary.completion.manifestStatus}; errors=${statSummary.completion.errorStatus}`,
        ]
      : []),
    `results/window: ${statSummary.resultCount}/${formatNumber(statSummary.windowDays, 2)}d`,
    `PnL/N/W/L/WR: ${formatNumber(statSummary.netProfit)}/${statSummary.orders}/${statSummary.wins}/${statSummary.losses}/${formatNumber(statSummary.winRatePct)}%`,
    `PnL/trade: ${formatNumber(statSummary.pnlPerTrade, 4)}`,
    `observed cadence: ${formatNumber(statSummary.observedCadenceTradesPerDay)} trades/day`,
    `projected cadence: ${projected}`,
    `worst symbol MaxDD: ${formatNumber(statSummary.worstSymbolMaxDrawdownPct)}% (not portfolio MaxDD)`,
  ].join('\n');
};

export const buildRunReport = async ({
  runId,
  userName = 'root',
  periods = DEFAULT_PERIODS,
  projectedUniverse = null,
}) => {
  const [manifest, envelopes] = await Promise.all([
    getData(redisKeys.backtestRun(userName, runId), null),
    getHashJsonValues(redisKeys.backtestRunResults(userName, runId)),
  ]);
  const results = envelopes
    .map((entry) => entry?.result ?? entry)
    .filter((entry) => entry?.test && entry?.stat);

  if (!results.length) {
    throw new Error(`No backtest results found for run ${runId}`);
  }

  const artifactAnalyses = await mapWithConcurrency(
    results,
    ARTIFACT_READ_CONCURRENCY,
    async (result) => {
      if (!result.orderLogId) return null;
      const orderLog = await readCachedOrderLog({
        userName,
        orderLogId: result.orderLogId,
      });
      return orderLog ? reconstructTrades([orderLog]) : null;
    },
  );

  const availableArtifacts = artifactAnalyses.filter(Boolean);
  const reconstructed = {
    trades: availableArtifacts
      .flatMap((artifact) => artifact.trades)
      .sort((a, b) => a.timestamp - b.timestamp),
    increaseEvents: availableArtifacts
      .flatMap((artifact) => artifact.increaseEvents)
      .sort((a, b) => a.timestamp - b.timestamp),
    incompleteCycles: availableArtifacts.reduce(
      (total, artifact) => total + artifact.incompleteCycles,
      0,
    ),
  };
  const startTimestamps = results
    .map((result) => toFiniteNumber(result.test.options?.start, Number.NaN))
    .filter(Number.isFinite);
  const endTimestamps = results
    .map((result) => toFiniteNumber(result.test.options?.end, Number.NaN))
    .filter(Number.isFinite);
  if (
    startTimestamps.length !== results.length ||
    endTimestamps.length !== results.length
  ) {
    throw new Error(`Run ${runId} contains invalid backtest time bounds`);
  }
  const startTimestamp = Math.min(...startTimestamps);
  const endTimestamp = Math.max(...endTimestamps);
  const fullDays = (endTimestamp - startTimestamp) / DAY_MS;
  const configStats = buildConfigStatSummaries({
    results,
    manifest,
    startTimestamp,
    endTimestamp,
    projectedUniverse,
  });
  const periodSpecs = [
    { label: `full (${formatNumber(fullDays, 0)}d)`, days: null },
    ...periods
      .filter((days) => days < fullDays - 0.5)
      .map((days) => ({ label: `${days}d`, days })),
  ];
  const artifactMetricsAvailable =
    configStats.configIds.length === 1 &&
    availableArtifacts.length === results.length;
  const artifactMetricsWarning = artifactMetricsAvailable
    ? null
    : configStats.configIds.length > 1
      ? `Artifact-derived periods are disabled for grid runs with multiple configId buckets (${configStats.configIds.join(', ')}) to avoid aggregating configs.`
      : `Artifact-derived periods are incomplete (${availableArtifacts.length}/${results.length} order logs); for --fast --ai runs use fast-ai-export-metrics.mjs instead.`;

  return {
    runId,
    userName,
    manifestStatus: manifest?.status ?? null,
    results: results.length,
    statSummary: configStats.statSummary,
    statSummariesByConfig: configStats.statSummariesByConfig,
    statSummaryWarnings: configStats.warnings,
    artifacts: availableArtifacts.length,
    missingArtifacts: results.length - availableArtifacts.length,
    incompleteCycles: reconstructed.incompleteCycles,
    trades: reconstructed.trades.length,
    increases: reconstructed.increaseEvents.length,
    periods: (artifactMetricsAvailable ? periodSpecs : []).map(
      ({ label, days }) => {
        const periodStart =
          days == null
            ? startTimestamp
            : Math.max(startTimestamp, endTimestamp - days * DAY_MS);
        return {
          label,
          startTimestamp: periodStart,
          endTimestamp,
          metrics: summarizeTradeWindow({
            ...reconstructed,
            startTimestamp: periodStart,
            endTimestamp,
          }),
        };
      },
    ),
    artifactMetricsAvailable,
    artifactMetricsWarning,
  };
};

const main = async () => {
  const flags = parseArgs(process.argv.slice(2));
  try {
    const report = await buildRunReport(flags);
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      [
        `run: ${report.runId}`,
        ...(report.statSummary
          ? [formatStatSummary(report.statSummary)]
          : Object.values(report.statSummariesByConfig).map(formatStatSummary)),
        ...report.statSummaryWarnings,
        '',
        `results/artifacts: ${report.results}/${report.artifacts} (missing=${report.missingArtifacts}, incomplete=${report.incompleteCycles})`,
        `trades/increases: ${report.trades}/${report.increases}`,
        ...(report.artifactMetricsWarning
          ? [report.artifactMetricsWarning]
          : []),
        '',
        formatSummaryTable(report),
        '',
      ].join('\n'),
    );
  } finally {
    await closeRedisConnection();
  }
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
