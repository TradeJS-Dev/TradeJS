import chalk from 'chalk';
import { formatUnix } from '@tradejs/core/time';
import type { Connector, ExchangeEntryRecord } from '@tradejs/types';
import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractRuntimeParityEntries,
  type TradeParityEntry,
} from '../runtimeParity';
import {
  summarizeRuntimeTradesByStrategy,
  summarizeTradeParityByStrategy,
} from '../paritySummary';
import { loadRuntimeTrades } from '../runtimeRedis';
import { loadClosedPnlRows, syncRuntimeTrades } from '../runtimeTradeSync';
import { createTable } from '../runFormatting';
import {
  buildReplayExchangeComparisonDetails,
  buildReplayRuntimeComparisonDetails,
  buildStrategyNameByOrderLinkKey,
  resolveReplayStrategyNameFromExchangeEntry,
  type ExchangeMatchedBacktestEntry,
} from '../runtimeParityDetails';
import { getRuntimeCompareContext } from '../backtest/runState';
import { replayUserName } from './cliConfig';
import {
  REPLAY_RUNTIME_COMPARISON_HEADERS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_BARS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  type ReplayRuntimeComparisonSummary,
  type ReplayRuntimeParityRow,
  type ReplayStrategySummary,
} from './support';

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
      openFee: closedPnl?.openFee ?? entry.openFee ?? null,
      closeFee: closedPnl?.closeFee ?? entry.closeFee ?? null,
      fundingFee: closedPnl?.fundingFee ?? entry.fundingFee ?? null,
      totalFee: closedPnl?.totalFee ?? entry.totalFee ?? null,
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
  const strategyNameByOrderLinkKey = buildStrategyNameByOrderLinkKey(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );

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
      details: buildReplayExchangeComparisonDetails({
        matched: [],
        exchangeOnly: [],
        backtestOnly: backtestEntries,
        exchangeEntries: [],
        backtestEntries,
        strategyNameByOrderLinkKey,
        toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
      }),
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
    details: buildReplayExchangeComparisonDetails({
      matched: comparison.matched,
      exchangeOnly: comparison.exchangeOnly,
      backtestOnly: comparison.backtestOnly,
      exchangeEntries,
      backtestEntries,
      strategyNameByOrderLinkKey,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    }),
  };
};

export const saveAndPrintReplayRuntimeComparison = async ({
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
    details: buildReplayRuntimeComparisonDetails({
      matched: comparison.matched,
      runtimeOnly: comparison.runtimeOnly,
      backtestOnly: comparison.backtestOnly,
      runtimeEntries: runtimeDedupe.entries,
      backtestEntries,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    }),
  };
};
