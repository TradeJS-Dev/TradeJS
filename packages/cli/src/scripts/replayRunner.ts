import chalk from 'chalk';
import {
  normalizeStrategyOrderLinkKey,
  parseStrategyOrderLinkKey,
} from '@tradejs/core/trade';
import { formatUnix } from '@tradejs/core/time';
import { setData, redisKeys } from '@tradejs/infra/redis';
import {
  Connector,
  ExchangeEntryRecord,
  StrategyChartSnapshot,
  StrategyChartsSnapshotResponse,
} from '@tradejs/types';
import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractBacktestEntryParityEntries,
  extractRuntimeParityEntries,
  type TradeParityEntry,
} from '../lib/runtimeParity';
import {
  summarizeRuntimeTradesByStrategy,
  summarizeTradeParityByStrategy,
} from '../lib/paritySummary';
import { loadRuntimeTrades } from '../lib/runtimeRedis';
import { loadClosedPnlRows, syncRuntimeTrades } from '../lib/runtimeTradeSync';
import { createTable, createTimestamp } from '../lib/runFormatting';
import {
  loadReplayStrategies,
  prepareRunEnvironment,
} from '../lib/runEnvironment';
import {
  setRuntimeCompareContext,
  getRunStartedAt,
  getRuntimeCompareContext,
  resetRunState,
  incrementSuccessTests,
  markTestsStarted,
} from '../lib/backtest/runState';
import {
  isReplayUpdateOnlyRun,
  replayFlags,
  replayInterval,
  replayProjectRoot,
  replayUserName,
} from '../lib/replay/cliConfig';
import {
  REPLAY_RESULTS_BY_STRATEGY_HEADERS,
  REPLAY_RESULTS_CONFIG,
  REPLAY_RUNTIME_COMPARISON_HEADERS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  type ReplayRuntimeComparisonSummary,
  type ReplayRuntimeParityRow,
  type ReplayStrategyResultsSnapshot,
  type ReplayStrategySummary,
} from '../lib/replay/support';
import {
  HistoricalSignalsReplayResult,
  runHistoricalSignalsReplay,
} from '../lib/replay/historicalSignalsReplay';

type ExchangeMatchedBacktestEntry = {
  exchange: ExchangeEntryRecord;
  backtest: TradeParityEntry;
  timestampDiffMs: number;
  priceDeltaPct: number | null;
};

const formatPercent = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : 'n/a';

const formatSigned = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value)
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
    : 'n/a';

const toSimpleOrderLog = (
  orderLog: HistoricalSignalsReplayResult['strategies'][number]['orderLog'],
) =>
  orderLog.map((entry) => [entry.timestamp, entry.amount] as [number, number]);

const buildReplayChartSnapshot = (params: {
  replayResult: HistoricalSignalsReplayResult;
  generatedAt: number;
  runLabel: string;
}) => {
  const { replayResult, generatedAt, runLabel } = params;
  const strategies: StrategyChartSnapshot[] = replayResult.strategies.map(
    ({ strategyName, strategyConfig, orderLog, stat }) => ({
      cardId: `${strategyName}-${generatedAt}`,
      generatedAt,
      strategyName,
      title: strategyName,
      subtitle: runLabel,
      symbols: [
        ...new Set(orderLog.map((entry) => entry.symbol).filter(Boolean)),
      ],
      orderLog: toSimpleOrderLog(orderLog),
      stat,
      metrics: [
        {
          id: 'orders',
          label: 'Orders',
          value: String(stat?.orders ?? 0),
        },
        {
          id: 'winRate',
          label: 'Win Rate',
          value: formatPercent(stat?.winRate ?? null),
        },
        {
          id: 'pnl',
          label: 'P&L',
          value: formatSigned(stat?.netProfit ?? null),
          tone:
            (stat?.netProfit ?? 0) > 0
              ? 'success'
              : (stat?.netProfit ?? 0) < 0
                ? 'error'
                : 'warning',
        },
        {
          id: 'drawdown',
          label: 'Drawdown',
          value: formatPercent(stat?.maxDrawdown ?? null),
        },
        {
          id: 'sharpe',
          label: 'Sharpe',
          value:
            typeof stat?.sharpeRatio === 'number'
              ? stat.sharpeRatio.toFixed(2)
              : 'n/a',
        },
        {
          id: 'exposure',
          label: 'Exposure',
          value: formatPercent(stat?.exposure ?? null),
        },
      ],
      tags:
        Object.keys(strategyConfig || {}).length > 0
          ? [`params:${Object.keys(strategyConfig || {}).length}`]
          : undefined,
    }),
  );

  return {
    mode: 'replay',
    generatedAt,
    runLabel,
    strategies,
  } satisfies StrategyChartsSnapshotResponse;
};

const buildStrategyNameByOrderLinkKey = (strategyNames: string[]) =>
  new Map(
    strategyNames.flatMap((strategyName) => {
      const strategyKey = normalizeStrategyOrderLinkKey(strategyName);
      return strategyKey ? [[strategyKey, strategyName] as const] : [];
    }),
  );

export const resolveReplayStrategyNameFromExchangeEntry = ({
  exchangeEntry,
  strategyNameByOrderLinkKey,
}: {
  exchangeEntry: Pick<ExchangeEntryRecord, 'orderLinkId'>;
  strategyNameByOrderLinkKey: Map<string, string>;
}) => {
  const strategyKey = parseStrategyOrderLinkKey(exchangeEntry.orderLinkId);
  if (!strategyKey) {
    return null;
  }

  return strategyNameByOrderLinkKey.get(strategyKey) ?? null;
};

const loadExchangeEntryRows = async ({
  connector,
  startTime,
  endTime,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
}): Promise<ExchangeEntryRecord[]> => {
  if (typeof connector.getEntryExecutions !== 'function') {
    console.log(
      chalk.yellow(
        'runtime compare: connector does not support entry execution history',
      ),
    );
    return [];
  }

  try {
    const rows = await connector.getEntryExecutions({
      startTime,
      endTime,
      limit: 100,
    });

    if (rows.length >= 100) {
      console.log(
        chalk.yellow(
          'runtime compare: exchange entry executions returned 100 rows (connector cap); older entry trades in the window may be truncated',
        ),
      );
    }

    return rows.sort(
      (left, right) => left.entryTimestamp - right.entryTimestamp,
    );
  } catch (error) {
    console.log(
      chalk.yellow(
        `runtime compare: getEntryExecutions failed: ${(error as Error)?.message || String(error)}`,
      ),
    );
    return [];
  }
};

const buildPriceDeltaPct = (
  leftPrice: number | null,
  rightPrice: number | null,
) => {
  if (
    leftPrice == null ||
    rightPrice == null ||
    !Number.isFinite(leftPrice) ||
    !Number.isFinite(rightPrice) ||
    leftPrice === 0
  ) {
    return null;
  }

  return Math.abs(((rightPrice - leftPrice) / leftPrice) * 100);
};

const loadExchangeEntriesForComparison = async ({
  connector,
  startTime,
  endTime,
}: {
  connector: Connector;
  startTime: number;
  endTime: number;
}): Promise<ExchangeEntryRecord[]> => {
  const entryRows = await loadExchangeEntryRows({
    connector,
    startTime,
    endTime,
  });
  const closedPnlRows = await loadClosedPnlRows({
    connector,
    startTime,
    endTime,
    callbacks: {
      onUnsupported: () => {
        console.log(
          chalk.yellow(
            'runtime compare: connector does not support getClosedPnl, using runtime trade records as-is',
          ),
        );
      },
      onCapped: () => {
        console.log(
          chalk.yellow(
            'runtime compare: exchange closed pnl returned 100 rows (connector cap); older closed trades in the window may be truncated',
          ),
        );
      },
      onError: (error) => {
        console.log(
          chalk.yellow(
            `runtime compare: getClosedPnl failed: ${(error as Error)?.message || String(error)}`,
          ),
        );
      },
    },
  });

  const closedPnlByOrderId = new Map(
    closedPnlRows
      .filter((row) => typeof row.orderId === 'string' && row.orderId.trim())
      .map((row) => [row.orderId as string, row]),
  );

  return entryRows.map((entry) => {
    const closedPnl =
      typeof entry.orderId === 'string'
        ? closedPnlByOrderId.get(entry.orderId)
        : null;

    return {
      ...entry,
      exitPrice: closedPnl?.exitPrice ?? entry.exitPrice ?? null,
      exitTimestamp: closedPnl?.closedAt ?? entry.exitTimestamp ?? null,
      closedPnl: closedPnl?.closedPnl ?? entry.closedPnl ?? null,
    };
  });
};

export const compareExchangeEntriesToBacktest = ({
  exchangeEntries,
  backtestEntries,
  toleranceMs,
}: {
  exchangeEntries: ExchangeEntryRecord[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
}) => {
  const groupedExchange = new Map<string, ExchangeEntryRecord[]>();
  const groupedBacktest = new Map<string, TradeParityEntry[]>();

  for (const entry of exchangeEntries) {
    const key = `${entry.symbol}::${entry.direction}`;
    const bucket = groupedExchange.get(key) ?? [];
    bucket.push(entry);
    groupedExchange.set(key, bucket);
  }

  for (const entry of backtestEntries) {
    const key = `${entry.symbol}::${entry.direction}`;
    const bucket = groupedBacktest.get(key) ?? [];
    bucket.push(entry);
    groupedBacktest.set(key, bucket);
  }

  const matched: ExchangeMatchedBacktestEntry[] = [];
  const exchangeOnly: ExchangeEntryRecord[] = [];
  const backtestOnly: TradeParityEntry[] = [];
  const matchedBacktestEntries = new Set<TradeParityEntry>();
  const groupKeys = new Set([
    ...groupedExchange.keys(),
    ...groupedBacktest.keys(),
  ]);

  for (const key of groupKeys) {
    const exchangeGroup = [...(groupedExchange.get(key) ?? [])].sort(
      (left, right) => left.entryTimestamp - right.entryTimestamp,
    );
    const availableBacktest = [...(groupedBacktest.get(key) ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
    const unmatchedBacktest = availableBacktest.map((entry) => ({
      entry,
      used: false,
    }));

    for (const exchangeEntry of exchangeGroup) {
      let bestIndex = -1;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (let index = 0; index < unmatchedBacktest.length; index += 1) {
        const candidate = unmatchedBacktest[index];
        if (candidate.used) {
          continue;
        }

        const diff = Math.abs(
          candidate.entry.timestamp - exchangeEntry.entryTimestamp,
        );
        if (diff > toleranceMs || diff >= bestDiff) {
          continue;
        }

        bestIndex = index;
        bestDiff = diff;
      }

      if (bestIndex < 0) {
        exchangeOnly.push(exchangeEntry);
        continue;
      }

      unmatchedBacktest[bestIndex].used = true;
      const backtestEntry = unmatchedBacktest[bestIndex].entry;
      matchedBacktestEntries.add(backtestEntry);
      matched.push({
        exchange: exchangeEntry,
        backtest: backtestEntry,
        timestampDiffMs: bestDiff,
        priceDeltaPct: buildPriceDeltaPct(
          exchangeEntry.entryPrice,
          backtestEntry.price,
        ),
      });
    }
  }

  for (const entry of backtestEntries) {
    if (!matchedBacktestEntries.has(entry)) {
      backtestOnly.push(entry);
    }
  }

  matched.sort(
    (left, right) =>
      left.exchange.entryTimestamp - right.exchange.entryTimestamp ||
      left.backtest.strategy.localeCompare(right.backtest.strategy),
  );
  exchangeOnly.sort(
    (left, right) => left.entryTimestamp - right.entryTimestamp,
  );
  backtestOnly.sort((left, right) => left.timestamp - right.timestamp);

  return {
    matched,
    exchangeOnly,
    backtestOnly,
  };
};

const saveAndPrintReplayResultsByStrategy = async ({
  replayResult,
  tickers,
}: {
  replayResult: HistoricalSignalsReplayResult;
  tickers: string[];
}): Promise<ReplayStrategyResultsSnapshot> => {
  const backtestEntries = replayResult.strategies.flatMap(({ orderLog }) =>
    extractBacktestEntryParityEntries(orderLog),
  );
  const summaries = replayResult.strategies
    .map(({ strategyName, strategyConfig, stat }) => {
      const orders = stat?.orders ?? 0;
      const wins = stat?.wins ?? 0;
      const losses = stat?.losses ?? 0;
      const netProfit = Number((stat?.netProfit ?? 0).toFixed(2));
      const winRate =
        orders > 0 ? Number(((wins / orders) * 100).toFixed(2)) : 0;
      const avgTradeProfit =
        orders > 0 ? Number((netProfit / orders).toFixed(2)) : 0;
      const tradedSymbols = new Set(
        backtestEntries
          .filter((entry) => entry.strategy === strategyName)
          .map((entry) => entry.symbol),
      );

      return {
        strategyName,
        strategyConfig,
        tickers: tickers.length,
        tickersWithTrades: tradedSymbols.size,
        orders,
        wins,
        losses,
        netProfit,
        avgTradeProfit,
        winRate,
      } satisfies ReplayStrategySummary;
    })
    .sort(
      (left, right) =>
        right.netProfit - left.netProfit ||
        left.strategyName.localeCompare(right.strategyName),
    );

  const rows = summaries.map((summary) => {
    const profit = `${summary.netProfit.toFixed(2)}$`;
    const avgTrade = `${summary.avgTradeProfit.toFixed(2)}$`;
    const profitColor =
      summary.netProfit > 0
        ? chalk.green
        : summary.netProfit < 0
          ? chalk.red
          : chalk.gray;
    const avgTradeColor =
      summary.avgTradeProfit > 0
        ? chalk.green
        : summary.avgTradeProfit < 0
          ? chalk.red
          : chalk.gray;

    return [
      chalk.blue(summary.strategyName),
      chalk.yellow(String(summary.tickers)),
      chalk.yellow(String(summary.tickersWithTrades)),
      chalk.cyan(String(summary.orders)),
      chalk.cyan(
        `${summary.wins}/${summary.losses} (${summary.winRate.toFixed(2)}%)`,
      ),
      profitColor(profit),
      avgTradeColor(avgTrade),
    ];
  });

  console.log('');
  console.log('SIGNALS REPLAY RESULTS BY STRATEGY:');
  console.log(createTable(REPLAY_RESULTS_BY_STRATEGY_HEADERS, rows));
  console.log('');

  return {
    summaries,
    backtestEntries,
  };
};

const saveAndPrintReplayExchangeComparison = async ({
  liveStrategySummaries,
  backtestEntries,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
}): Promise<ReplayRuntimeComparisonSummary> => {
  const { connector, connectorName, window } = getRuntimeCompareContext();
  const exchangeEntries = await loadExchangeEntriesForComparison({
    connector: connector!,
    startTime: window!.start,
    endTime: window!.end,
  });

  if (!exchangeEntries.length) {
    console.log('');
    console.log(
      chalk.yellow(
        `SIGNALS REPLAY VS EXCHANGE: no exchange entry executions found for ${connectorName} in ${formatUnix(
          window!.start,
        )} -> ${formatUnix(window!.end)}`,
      ),
    );
    console.log('');

    return {
      mode: 'exchange',
      syncedTradesCount: 0,
      windowTradesCount: 0,
      runtimeEntriesCount: 0,
      backtestEntriesCount: backtestEntries.length,
      matchedCount: 0,
      runtimeOnlyCount: 0,
      backtestOnlyCount: backtestEntries.length,
      rows: liveStrategySummaries.map((summary) => ({
        strategyName: summary.strategyName,
        backtestEntries: backtestEntries.filter(
          (entry) => entry.strategy === summary.strategyName,
        ).length,
        backtestNetProfit: summary.netProfit,
        runtimeTrades: 0,
        runtimePnl: 0,
        matched: 0,
        runtimeOnly: 0,
        backtestOnly: backtestEntries.filter(
          (entry) => entry.strategy === summary.strategyName,
        ).length,
      })),
    };
  }

  const comparison = compareExchangeEntriesToBacktest({
    exchangeEntries,
    backtestEntries,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  });
  const liveSummaryByStrategy = new Map(
    liveStrategySummaries.map((summary) => [summary.strategyName, summary]),
  );
  const rowByStrategy = new Map<string, ReplayRuntimeParityRow>();
  const strategyNameByOrderLinkKey = buildStrategyNameByOrderLinkKey(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );
  const ensureRow = (strategyName: string) => {
    const existing = rowByStrategy.get(strategyName);
    if (existing) {
      return existing;
    }

    const next: ReplayRuntimeParityRow = {
      strategyName,
      backtestEntries: 0,
      backtestNetProfit:
        liveSummaryByStrategy.get(strategyName)?.netProfit ?? 0,
      runtimeTrades: 0,
      runtimePnl: 0,
      matched: 0,
      runtimeOnly: 0,
      backtestOnly: 0,
    };
    rowByStrategy.set(strategyName, next);
    return next;
  };

  for (const summary of liveStrategySummaries) {
    ensureRow(summary.strategyName);
  }

  for (const entry of backtestEntries) {
    ensureRow(entry.strategy).backtestEntries += 1;
  }

  for (const item of comparison.matched) {
    const row = ensureRow(item.backtest.strategy);
    row.runtimeTrades += 1;
    row.matched += 1;
    if (
      typeof item.exchange.closedPnl === 'number' &&
      Number.isFinite(item.exchange.closedPnl)
    ) {
      row.runtimePnl += item.exchange.closedPnl;
    }
  }

  for (const entry of comparison.backtestOnly) {
    ensureRow(entry.strategy).backtestOnly += 1;
  }

  if (comparison.exchangeOnly.length) {
    for (const entry of comparison.exchangeOnly) {
      const strategyName =
        resolveReplayStrategyNameFromExchangeEntry({
          exchangeEntry: entry,
          strategyNameByOrderLinkKey,
        }) ?? '[exchange-unmatched]';
      const row = ensureRow(strategyName);
      row.runtimeTrades += 1;
      row.runtimeOnly += 1;
      if (
        typeof entry.closedPnl === 'number' &&
        Number.isFinite(entry.closedPnl)
      ) {
        row.runtimePnl += entry.closedPnl;
      }
    }
  }

  const rows = [...rowByStrategy.values()]
    .map((row) => ({
      ...row,
      runtimePnl: Number(row.runtimePnl.toFixed(2)),
    }))
    .sort((left, right) => left.strategyName.localeCompare(right.strategyName));

  const colorizedRows = rows.map((row) => {
    const btPnlColor =
      row.backtestNetProfit > 0
        ? chalk.green
        : row.backtestNetProfit < 0
          ? chalk.red
          : chalk.gray;
    const rtPnlColor =
      row.runtimePnl > 0
        ? chalk.green
        : row.runtimePnl < 0
          ? chalk.red
          : chalk.gray;

    return [
      chalk.blue(row.strategyName),
      chalk.cyan(String(row.backtestEntries)),
      btPnlColor(`${row.backtestNetProfit.toFixed(2)}$`),
      chalk.yellow(String(row.runtimeTrades)),
      rtPnlColor(`${row.runtimePnl.toFixed(2)}$`),
      chalk.green(String(row.matched)),
      chalk.yellow(String(row.runtimeOnly)),
      chalk.magenta(String(row.backtestOnly)),
    ];
  });

  console.log('');
  console.log(
    `SIGNALS REPLAY VS EXCHANGE BY STRATEGY (connector=${connectorName}, inferredStrategy=orderLinkId | nearest backtest entry, tolerance=${REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS} bar)`,
  );
  console.log(createTable(REPLAY_RUNTIME_COMPARISON_HEADERS, colorizedRows));
  console.log('');

  return {
    mode: 'exchange',
    syncedTradesCount: exchangeEntries.length,
    windowTradesCount: exchangeEntries.length,
    runtimeEntriesCount: exchangeEntries.length,
    backtestEntriesCount: backtestEntries.length,
    matchedCount: comparison.matched.length,
    runtimeOnlyCount: comparison.exchangeOnly.length,
    backtestOnlyCount: comparison.backtestOnly.length,
    rows,
  };
};

const saveAndPrintReplayRuntimeComparison = async ({
  liveStrategySummaries,
  backtestEntries,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
}): Promise<ReplayRuntimeComparisonSummary | null> => {
  const { connector, connectorName, window } = getRuntimeCompareContext();
  if (!connector || !window) {
    return null;
  }

  const relevantStrategies = new Set(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );
  const rawRuntimeTrades = await loadRuntimeTrades(replayUserName);
  const syncedRuntimeTrades = await syncRuntimeTrades({
    userName: replayUserName,
    connector,
    trades: rawRuntimeTrades,
    startTime: window.start,
    endTime: window.end,
    closedPnlCallbacks: {
      onUnsupported: () => {
        console.log(
          chalk.yellow(
            'runtime compare: connector does not support getClosedPnl, using runtime trade records as-is',
          ),
        );
      },
      onCapped: () => {
        console.log(
          chalk.yellow(
            'runtime compare: exchange closed pnl returned 100 rows (connector cap); older closed trades in the window may be truncated',
          ),
        );
      },
      onError: (error) => {
        console.log(
          chalk.yellow(
            `runtime compare: getClosedPnl failed: ${(error as Error)?.message || String(error)}`,
          ),
        );
      },
    },
  });
  const windowRuntimeTrades = syncedRuntimeTrades.filter(
    (trade) =>
      trade.entryTimestamp >= window.start &&
      trade.entryTimestamp < window.end &&
      relevantStrategies.has(trade.strategy),
  );

  if (!windowRuntimeTrades.length) {
    console.log('');
    console.log(
      chalk.yellow(
        `SIGNALS REPLAY VS RUNTIME: no local runtime trades found for ${connectorName} in ${formatUnix(
          window.start,
        )} -> ${formatUnix(window.end)}; falling back to direct exchange comparison`,
      ),
    );
    console.log('');
    return saveAndPrintReplayExchangeComparison({
      liveStrategySummaries,
      backtestEntries,
    });
  }

  const runtimeSummaries =
    summarizeRuntimeTradesByStrategy(windowRuntimeTrades);
  const runtimeSummaryByStrategy = new Map(
    runtimeSummaries.map((summary) => [summary.strategyName, summary]),
  );
  const rawRuntimeEntries = extractRuntimeParityEntries(windowRuntimeTrades);
  const runtimeDedupe = dedupeRuntimeParityEntries(rawRuntimeEntries);
  const comparison = compareTradeParityEntries({
    runtimeEntries: runtimeDedupe.entries,
    backtestEntries,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  });
  const parityRows = summarizeTradeParityByStrategy({
    runtimeEntries: runtimeDedupe.entries,
    runtimeDuplicateEntries: runtimeDedupe.duplicateEntries,
    backtestEntries,
    matchedEntries: comparison.matched,
    runtimeOnlyEntries: comparison.runtimeOnly,
    backtestOnlyEntries: comparison.backtestOnly,
  });
  const parityByStrategy = new Map(parityRows);
  const liveSummaryByStrategy = new Map(
    liveStrategySummaries.map((summary) => [summary.strategyName, summary]),
  );

  const strategyNames = new Set<string>([
    ...liveSummaryByStrategy.keys(),
    ...runtimeSummaryByStrategy.keys(),
    ...parityByStrategy.keys(),
  ]);
  const rows = [...strategyNames]
    .sort((left, right) => left.localeCompare(right))
    .map((strategyName) => {
      const liveSummary = liveSummaryByStrategy.get(strategyName);
      const runtimeSummary = runtimeSummaryByStrategy.get(strategyName);
      const parity = parityByStrategy.get(strategyName);

      return {
        strategyName,
        backtestEntries: parity?.backtest ?? 0,
        backtestNetProfit: liveSummary?.netProfit ?? 0,
        runtimeTrades: runtimeSummary?.trades ?? 0,
        runtimePnl: runtimeSummary?.totalPnl ?? 0,
        matched: parity?.matched ?? 0,
        runtimeOnly: parity?.runtimeOnly ?? 0,
        backtestOnly: parity?.backtestOnly ?? 0,
      };
    });

  const colorizedRows = rows.map((row) => {
    const btPnlColor =
      row.backtestNetProfit > 0
        ? chalk.green
        : row.backtestNetProfit < 0
          ? chalk.red
          : chalk.gray;
    const rtPnlColor =
      row.runtimePnl > 0
        ? chalk.green
        : row.runtimePnl < 0
          ? chalk.red
          : chalk.gray;

    return [
      chalk.blue(row.strategyName),
      chalk.cyan(String(row.backtestEntries)),
      btPnlColor(`${row.backtestNetProfit.toFixed(2)}$`),
      chalk.yellow(String(row.runtimeTrades)),
      rtPnlColor(`${row.runtimePnl.toFixed(2)}$`),
      chalk.green(String(row.matched)),
      chalk.yellow(String(row.runtimeOnly)),
      chalk.magenta(String(row.backtestOnly)),
    ];
  });

  console.log('');
  console.log(
    `SIGNALS REPLAY VS RUNTIME BY STRATEGY (connector=${connectorName}, tolerance=${REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS} bar)`,
  );
  console.log(createTable(REPLAY_RUNTIME_COMPARISON_HEADERS, colorizedRows));
  console.log('');

  return {
    mode: 'runtime',
    syncedTradesCount: syncedRuntimeTrades.length,
    windowTradesCount: windowRuntimeTrades.length,
    runtimeEntriesCount: runtimeDedupe.entries.length,
    backtestEntriesCount: backtestEntries.length,
    matchedCount: comparison.matched.length,
    runtimeOnlyCount: comparison.runtimeOnly.length,
    backtestOnlyCount: comparison.backtestOnly.length,
    rows,
  };
};

const finishReplay = async ({
  replayResult,
  tickers,
}: {
  replayResult: HistoricalSignalsReplayResult;
  tickers: string[];
}) => {
  const replayStrategySnapshot = await saveAndPrintReplayResultsByStrategy({
    replayResult,
    tickers,
  });
  const replayRuntimeComparison = await saveAndPrintReplayRuntimeComparison({
    liveStrategySummaries: replayStrategySnapshot.summaries,
    backtestEntries: replayStrategySnapshot.backtestEntries,
  });

  const finishedAt = new Date();
  const durationSeconds = Number(
    ((Date.now() - getRunStartedAt()) / 1000).toFixed(2),
  );
  const timestamp = createTimestamp(finishedAt);
  const replayChartSnapshot = replayFlags.chart
    ? buildReplayChartSnapshot({
        replayResult,
        generatedAt: finishedAt.getTime(),
        runLabel: `${formatUnix(
          replayResult.orderLog[0]?.timestamp ?? finishedAt.getTime(),
        )} -> ${formatUnix(
          replayResult.orderLog[replayResult.orderLog.length - 1]?.timestamp ??
            finishedAt.getTime(),
        )}`,
      })
    : null;

  await setData(
    redisKeys.backtestResults(replayUserName, REPLAY_RESULTS_CONFIG, timestamp),
    {
      config: REPLAY_RESULTS_CONFIG,
      mode: 'replay',
      user: replayUserName,
      startedAt: new Date(getRunStartedAt()).toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      results: [],
      resultsByTickers: [],
      resultsByStrategies: replayStrategySnapshot.summaries,
      runtimeComparison: replayRuntimeComparison,
      bestConfig: null,
      mergedConfig: null,
      successTests: replayResult.strategies.length,
      errors: [],
      errorTests: 0,
      cycleCount: replayResult.cycleCount,
      abortedCycles: replayResult.abortedCycles,
      signalsCount: replayResult.signals.length,
      strategyCharts: replayChartSnapshot,
    },
    {
      expire: 0,
    },
  );

  if (replayChartSnapshot) {
    await Promise.all(
      replayChartSnapshot.strategies.map((card) =>
        setData(
          redisKeys.strategyChartCard(replayUserName, 'replay', card.cardId),
          card,
          {
            expire: 0,
          },
        ),
      ),
    );
  }

  process.exit();
};

export const replayBacktest = async () => {
  resetRunState();
  const preparedRun = await prepareRunEnvironment({
    connector: replayFlags.connector,
    userName: replayUserName,
    tickers: replayFlags.tickers,
    exclude: replayFlags.exclude,
    tickersLimit: replayFlags.tickersLimit,
    showTickersList: replayFlags.showTickersList,
    days: replayFlags.days,
    startTime: replayFlags.startTime,
    endTime: replayFlags.endTime,
    cacheOnly: replayFlags.cacheOnly,
    interval: replayInterval,
    projectRoot: replayProjectRoot,
  });
  if (!preparedRun || isReplayUpdateOnlyRun) {
    return;
  }
  setRuntimeCompareContext({
    connector: preparedRun.marketConnector,
    connectorName: preparedRun.connectorName,
    window: {
      start: preparedRun.window.start,
      end: preparedRun.window.end,
    },
  });

  const replayStrategies = await loadReplayStrategies(replayUserName);
  if (!replayStrategies.length) {
    return;
  }

  console.log(chalk.yellow(`tickers: ${preparedRun.tickers.length}`));
  console.log(
    chalk.gray(
      `mode: replay (${replayStrategies
        .map(({ strategyName }) => strategyName)
        .join(', ')})`,
    ),
  );
  markTestsStarted();

  const replayResult = await runHistoricalSignalsReplay({
    preparedRun,
    interval: replayInterval,
    runtimeStrategies: replayStrategies,
  });

  for (const _strategy of replayResult.strategies) {
    incrementSuccessTests();
  }

  await finishReplay({
    replayResult,
    tickers: preparedRun.tickers,
  });
};
