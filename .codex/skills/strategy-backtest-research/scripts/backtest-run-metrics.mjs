#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateAdvancedTradeMetrics } from '@tradejs/core/backtest';
import {
  closeRedisConnection,
  getHashJsonValues,
  redisKeys,
} from '@tradejs/infra/redis';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PERIODS = [180, 90, 30, 7];
const ARTIFACT_READ_CONCURRENCY = 8;

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

const parseArgs = (argv) => {
  const parsed = {
    runId: null,
    userName: 'root',
    periods: DEFAULT_PERIODS,
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

export const buildRunReport = async ({
  runId,
  userName = 'root',
  periods = DEFAULT_PERIODS,
}) => {
  const envelopes = await getHashJsonValues(
    redisKeys.backtestRunResults(userName, runId),
  );
  const results = envelopes
    .map((entry) => entry?.result ?? entry)
    .filter((entry) => entry?.orderLogId && entry?.test);

  if (!results.length) {
    throw new Error(`No backtest results found for run ${runId}`);
  }

  const artifactAnalyses = await mapWithConcurrency(
    results,
    ARTIFACT_READ_CONCURRENCY,
    async (result) => {
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
  const periodSpecs = [
    { label: `full (${formatNumber(fullDays, 0)}d)`, days: null },
    ...periods
      .filter((days) => days < fullDays - 0.5)
      .map((days) => ({ label: `${days}d`, days })),
  ];

  return {
    runId,
    userName,
    results: results.length,
    artifacts: availableArtifacts.length,
    missingArtifacts: results.length - availableArtifacts.length,
    incompleteCycles: reconstructed.incompleteCycles,
    trades: reconstructed.trades.length,
    increases: reconstructed.increaseEvents.length,
    periods: periodSpecs.map(({ label, days }) => {
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
    }),
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
        `results/artifacts: ${report.results}/${report.artifacts} (missing=${report.missingArtifacts}, incomplete=${report.incompleteCycles})`,
        `trades/increases: ${report.trades}/${report.increases}`,
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
