import chalk from 'chalk';
import { formatUnix } from '@tradejs/core/time';
import type {
  Connector,
  ExchangeEntryRecord,
  RuntimeSignalEvaluationRecord,
  Signal,
} from '@tradejs/types';
import {
  compareTradeParityEntries,
  dedupeRuntimeParityEntries,
  extractRuntimeParityEntries,
  getBacktestParityComparisonTimestamp,
  type TradeParityEntry,
} from '../runtimeParity';
import {
  summarizeRuntimeTradesByStrategy,
  summarizeTradeParityByStrategy,
} from '../paritySummary';
import { loadRuntimeTrades } from '../runtimeRedis';
import {
  loadRuntimeSignalEvaluations,
  loadRuntimeSignals,
} from '../runtimeSignalsLoader';
import {
  formatRuntimeTradeSyncError,
  loadClosedPnlRows,
  splitExchangeHistoryTimeRange,
  syncRuntimeTrades,
} from '../runtimeTradeSync';
import { createTable } from '../runFormatting';
import {
  buildReplayExchangeComparisonDetails,
  buildReplayRuntimeComparisonDetails,
  buildStrategyNameByOrderLinkKey,
  resolveReplayStrategyNameFromExchangeEntry,
  type ExchangeMatchedBacktestEntry,
} from '../runtimeParityDetails';
import { getRuntimeCompareContext } from '../backtest/runState';
import { replayInterval, replayUserName } from './cliConfig';
import {
  REPLAY_RUNTIME_COMPARISON_HEADERS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  formatReplayRuntimeCompareTolerance,
  type ReplayRuntimeComparisonSummary,
  type ReplayRuntimeParityRow,
  type ReplayStrategySummary,
} from './support';

const getReplayEntryTimestampCompareOffsetMs = () => {
  const intervalMinutes = Number(replayInterval);
  return Number.isFinite(intervalMinutes) && intervalMinutes > 0
    ? intervalMinutes * 60 * 1000
    : 15 * 60 * 1000;
};

const buildReplaySignalEvaluations = (
  signals: Signal[],
): RuntimeSignalEvaluationRecord[] =>
  signals.map((signal) => ({
    evaluationId: `${signal.strategy}:${signal.symbol}:${signal.timestamp}`,
    userName: replayUserName,
    strategy: signal.strategy,
    symbol: signal.symbol,
    interval: signal.interval,
    timestamp: signal.timestamp,
    evaluatedAt: signal.timestamp,
    status: 'signal',
    reason: signal.orderSkipReason || signal.orderStatus || 'SIGNAL',
    signalId: signal.signalId,
    direction: signal.direction,
    orderStatus: signal.orderStatus,
    orderSkipReason: signal.orderSkipReason,
    ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
    ...(signal.ml ? { ml: signal.ml } : {}),
  }));

const formatDrilldownSummary = (summary: Record<string, number>) =>
  Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([classification, count]) => `${classification}=${count}`)
    .join(', ');

const toFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const sumOptionalNumbers = (values: Array<number | null | undefined>) => {
  let sum = 0;
  let hasValue = false;

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    sum += value;
    hasValue = true;
  }

  return hasValue ? Number(sum.toFixed(12)) : null;
};

const firstFiniteNumber = (values: Array<number | null | undefined>) => {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const firstString = (values: Array<string | undefined>) =>
  values.find((value) => typeof value === 'string' && value.trim());

const getExchangeExecutionMergeKey = (entry: ExchangeEntryRecord) => {
  const orderId = firstString([entry.orderId, entry.orderLinkId]);
  return orderId ? `${entry.symbol}::${entry.direction}::${orderId}` : null;
};

const mergeExchangeExecutionGroup = (
  group: ExchangeEntryRecord[],
): ExchangeEntryRecord => {
  const [first] = group;
  const qty = sumOptionalNumbers(group.map((entry) => entry.qty)) ?? first.qty;
  const weightedPriceSum = group.reduce((sum, entry) => {
    const entryQty = toFiniteNumberOrNull(entry.qty);
    const entryPrice = toFiniteNumberOrNull(entry.entryPrice);
    return entryQty != null && entryPrice != null
      ? sum + entryQty * entryPrice
      : sum;
  }, 0);
  const entryPrice =
    qty > 0 && weightedPriceSum > 0
      ? Number((weightedPriceSum / qty).toFixed(12))
      : firstFiniteNumber(group.map((entry) => entry.entryPrice));
  const openFee = sumOptionalNumbers(group.map((entry) => entry.openFee));
  const closeFee = sumOptionalNumbers(group.map((entry) => entry.closeFee));
  const fundingFee = firstFiniteNumber(group.map((entry) => entry.fundingFee));
  const totalFee =
    sumOptionalNumbers([openFee, closeFee, fundingFee]) ??
    firstFiniteNumber(group.map((entry) => entry.totalFee));

  return {
    symbol: first.symbol,
    direction: first.direction,
    qty,
    entryPrice,
    entryTimestamp: Math.min(...group.map((entry) => entry.entryTimestamp)),
    ...(firstString(group.map((entry) => entry.orderId))
      ? { orderId: firstString(group.map((entry) => entry.orderId)) }
      : {}),
    ...(firstString(group.map((entry) => entry.orderLinkId))
      ? { orderLinkId: firstString(group.map((entry) => entry.orderLinkId)) }
      : {}),
    ...(firstFiniteNumber(group.map((entry) => entry.takeProfitPrice)) != null
      ? {
          takeProfitPrice: firstFiniteNumber(
            group.map((entry) => entry.takeProfitPrice),
          ),
        }
      : {}),
    ...(firstFiniteNumber(group.map((entry) => entry.stopLossPrice)) != null
      ? {
          stopLossPrice: firstFiniteNumber(
            group.map((entry) => entry.stopLossPrice),
          ),
        }
      : {}),
    ...(firstFiniteNumber(group.map((entry) => entry.exitPrice)) != null
      ? { exitPrice: firstFiniteNumber(group.map((entry) => entry.exitPrice)) }
      : {}),
    ...(firstFiniteNumber(group.map((entry) => entry.exitTimestamp)) != null
      ? {
          exitTimestamp: firstFiniteNumber(
            group.map((entry) => entry.exitTimestamp),
          ),
        }
      : {}),
    ...(sumOptionalNumbers(group.map((entry) => entry.closedPnl)) != null
      ? { closedPnl: sumOptionalNumbers(group.map((entry) => entry.closedPnl)) }
      : {}),
    ...(openFee != null ? { openFee } : {}),
    ...(closeFee != null ? { closeFee } : {}),
    ...(fundingFee != null ? { fundingFee } : {}),
    ...(totalFee != null ? { totalFee } : {}),
  };
};

const mergeExchangeEntryExecutions = (rows: ExchangeEntryRecord[]) => {
  const mergedRows: ExchangeEntryRecord[] = [];
  const groups = new Map<string, ExchangeEntryRecord[]>();

  for (const row of rows) {
    const key = getExchangeExecutionMergeKey(row);
    if (!key) {
      mergedRows.push(row);
      continue;
    }

    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    mergedRows.push(
      group.length === 1 ? group[0] : mergeExchangeExecutionGroup(group),
    );
  }

  return mergedRows.sort(
    (left, right) => left.entryTimestamp - right.entryTimestamp,
  );
};

export const loadExchangeEntryRows = async ({
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

  const rows: ExchangeEntryRecord[] = [];
  const chunks = splitExchangeHistoryTimeRange({ startTime, endTime });

  for (const chunk of chunks) {
    try {
      const chunkRows = await connector.getEntryExecutions({
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        limit: 100,
      });

      if (chunkRows.length >= 100) {
        console.log(
          chalk.yellow(
            'runtime compare: exchange entry executions returned 100 rows (connector cap); older entry trades in this chunk may be truncated',
          ),
        );
      }

      rows.push(...chunkRows);
    } catch (error) {
      console.log(
        chalk.yellow(
          `runtime compare: getEntryExecutions failed: ${formatRuntimeTradeSyncError(error)}`,
        ),
      );
    }
  }

  return mergeExchangeEntryExecutions(rows);
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
            `runtime compare: getClosedPnl failed: ${formatRuntimeTradeSyncError(error)}`,
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
  backtestTimestampOffsetMs = 0,
}: {
  exchangeEntries: ExchangeEntryRecord[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
  backtestTimestampOffsetMs?: number;
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
          getBacktestParityComparisonTimestamp(
            candidate.entry,
            backtestTimestampOffsetMs,
          ) - exchangeEntry.entryTimestamp,
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
  replaySignals,
  replaySignalEvaluations,
  runtimeSignals,
  runtimeSignalEvaluations,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
  replaySignals: Signal[];
  replaySignalEvaluations: RuntimeSignalEvaluationRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
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

    const details = buildReplayExchangeComparisonDetails({
      matched: [],
      exchangeOnly: [],
      backtestOnly: backtestEntries,
      exchangeEntries: [],
      backtestEntries,
      strategyNameByOrderLinkKey,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
      backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
      runtimeSignals,
      runtimeSignalEvaluations,
      replaySignals,
      replaySignalEvaluations,
    });

    return {
      mode: 'exchange',
      syncedTradesCount: 0,
      windowTradesCount: 0,
      runtimeEntriesCount: 0,
      backtestEntriesCount: backtestEntries.length,
      matchedCount: 0,
      runtimeOnlyCount: 0,
      backtestOnlyCount: backtestEntries.length,
      details,
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
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
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

  const details = buildReplayExchangeComparisonDetails({
    matched: comparison.matched,
    exchangeOnly: comparison.exchangeOnly,
    backtestOnly: comparison.backtestOnly,
    exchangeEntries,
    backtestEntries,
    strategyNameByOrderLinkKey,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    runtimeSignals,
    runtimeSignalEvaluations,
    replaySignals,
    replaySignalEvaluations,
  });

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
    `SIGNALS REPLAY VS EXCHANGE BY STRATEGY (connector=${connectorName}, inferredStrategy=orderLinkId | nearest backtest entry, tolerance=${formatReplayRuntimeCompareTolerance()})`,
  );
  console.log(createTable(REPLAY_RUNTIME_COMPARISON_HEADERS, colorizedRows));
  const runtimeOnlyDrilldownSummary = formatDrilldownSummary(
    details.mismatchDrilldown?.summary.runtimeOnly ?? {},
  );
  const backtestOnlyDrilldownSummary = formatDrilldownSummary(
    details.mismatchDrilldown?.summary.backtestOnly ?? {},
  );
  if (runtimeOnlyDrilldownSummary || backtestOnlyDrilldownSummary) {
    console.log(
      chalk.gray(
        `Mismatch drilldown: exchangeOnly=[${runtimeOnlyDrilldownSummary || 'none'}], backtestOnly=[${backtestOnlyDrilldownSummary || 'none'}]`,
      ),
    );
  }
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
    details,
  };
};

export const saveAndPrintReplayRuntimeComparison = async ({
  liveStrategySummaries,
  backtestEntries,
  replaySignals,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
  replaySignals: Signal[];
}): Promise<ReplayRuntimeComparisonSummary | null> => {
  const { connector, connectorName, window } = getRuntimeCompareContext();
  if (!connector || !window) {
    return null;
  }

  const relevantStrategies = new Set(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );
  const replaySignalEvaluations = buildReplaySignalEvaluations(replaySignals);
  const [rawRuntimeTrades, runtimeSignals, runtimeSignalEvaluations] =
    await Promise.all([
      loadRuntimeTrades(replayUserName),
      loadRuntimeSignals(replayUserName, {
        startTime: window.start,
        endTime: window.end,
      }),
      loadRuntimeSignalEvaluations(replayUserName, {
        startTime: window.start,
        endTime: window.end,
      }),
    ]);
  const syncedRuntimeTrades = await syncRuntimeTrades({
    userName: replayUserName,
    connector,
    trades: rawRuntimeTrades,
    startTime: window.start,
    endTime: window.end,
    openPositionCallbacks: {
      onError: (error) => {
        console.log(
          chalk.yellow(
            `runtime compare: getOpenPositionPnl failed: ${formatRuntimeTradeSyncError(error)}; continuing without open-position mark prices`,
          ),
        );
      },
    },
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
            `runtime compare: getClosedPnl failed: ${formatRuntimeTradeSyncError(error)}`,
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
      replaySignals,
      replaySignalEvaluations,
      runtimeSignals,
      runtimeSignalEvaluations,
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
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
  });
  const details = buildReplayRuntimeComparisonDetails({
    matched: comparison.matched,
    runtimeOnly: comparison.runtimeOnly,
    backtestOnly: comparison.backtestOnly,
    runtimeEntries: runtimeDedupe.entries,
    backtestEntries,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    runtimeSignals,
    runtimeSignalEvaluations,
    replaySignals,
    replaySignalEvaluations,
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
    `SIGNALS REPLAY VS RUNTIME BY STRATEGY (connector=${connectorName}, tolerance=${formatReplayRuntimeCompareTolerance()})`,
  );
  console.log(createTable(REPLAY_RUNTIME_COMPARISON_HEADERS, colorizedRows));
  const runtimeOnlyDrilldownSummary = formatDrilldownSummary(
    details.mismatchDrilldown?.summary.runtimeOnly ?? {},
  );
  const backtestOnlyDrilldownSummary = formatDrilldownSummary(
    details.mismatchDrilldown?.summary.backtestOnly ?? {},
  );
  if (runtimeOnlyDrilldownSummary || backtestOnlyDrilldownSummary) {
    console.log(
      chalk.gray(
        `Mismatch drilldown: runtimeOnly=[${runtimeOnlyDrilldownSummary || 'none'}], backtestOnly=[${backtestOnlyDrilldownSummary || 'none'}]`,
      ),
    );
  }
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
    details,
  };
};
