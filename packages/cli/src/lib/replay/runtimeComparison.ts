import chalk from 'chalk';
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
  type TradeParityEntry,
} from '../runtimeParity';
import {
  summarizeRuntimeTradesByStrategy,
  summarizeTradeParityByStrategy,
} from '../paritySummary';
import { loadRuntimeTrades } from '../runtimeRedis';
import {
  loadRuntimeLineageScopes,
  loadRuntimeSignalEvaluations,
  loadRuntimeSignals,
} from '../runtimeSignalsLoader';
import {
  formatRuntimeTradeSyncError,
  loadClosedPnlRows,
  splitExchangeHistoryTimeRange,
  syncRuntimeTrades,
} from '../runtimeTradeSync';
import {
  buildReplayExchangeComparisonDetails,
  buildReplayRuntimeComparisonDetails,
  buildStrategyNameByOrderLinkKey,
  resolveReplayStrategyNameFromExchangeEntry,
} from '../runtimeParityDetails';
import { getRuntimeCompareContext } from '../backtest/runState';
import { replayInterval, replayProjectRoot, replayUserName } from './cliConfig';
import { loadReplayRuntimeEvidenceSource } from './runtimeEvidenceSource';
import {
  REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  type ReplayRuntimeComparisonSummary,
  type ReplayStrategySummary,
} from './support';
import type { ReplayRuntimeLineageRecord } from './historicalSignalsReplay';
import {
  buildExchangeComparisonRows,
  buildRuntimeComparisonRows,
  compareExchangeEntriesToBacktest,
  filterReplayComparisonByLineage,
  hasLineageLinkedRuntimeOutcome,
  splitExchangeMatchesByRuntimeOrderStatus,
} from './runtimeComparisonCalculations';
import {
  buildNoExchangeEntriesReport,
  buildNoRuntimeTradesReport,
  buildReplayComparisonReport,
  writeReplayComparisonReport,
} from './runtimeComparisonReporting';

export {
  compareExchangeEntriesToBacktest,
  filterReplayComparisonByLineage,
  splitExchangeMatchesByRuntimeOrderStatus,
} from './runtimeComparisonCalculations';

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
    accountId: signal.accountId,
    deploymentId: signal.deploymentId,
    runtimeLineage: signal.runtimeLineage,
    orderStatus: signal.orderStatus,
    orderSkipReason: signal.orderSkipReason,
    ...(signal.aiAnalysis ? { aiAnalysis: signal.aiAnalysis } : {}),
    ...(signal.ml ? { ml: signal.ml } : {}),
  }));

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

const saveAndPrintReplayExchangeComparison = async ({
  liveStrategySummaries,
  backtestEntries,
  replaySignals,
  replaySignalEvaluations,
  runtimeSignals,
  runtimeSignalEvaluations,
  lineage,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
  replaySignals: Signal[];
  replaySignalEvaluations: RuntimeSignalEvaluationRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  lineage: ReplayRuntimeComparisonSummary['lineage'];
}): Promise<ReplayRuntimeComparisonSummary> => {
  const { connector, connectorName, window } = getRuntimeCompareContext();
  const rawExchangeEntries = await loadExchangeEntriesForComparison({
    connector: connector!,
    startTime: window!.start,
    endTime: window!.end,
  });
  const strategyNameByOrderLinkKey = buildStrategyNameByOrderLinkKey(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );
  const exchangeEntries = rawExchangeEntries.filter((entry) => {
    const strategyName = resolveReplayStrategyNameFromExchangeEntry({
      exchangeEntry: entry,
      strategyNameByOrderLinkKey,
    });
    if (!strategyName) {
      return false;
    }
    return hasLineageLinkedRuntimeOutcome({
      exchangeEntry: entry,
      strategyName,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
      signalTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    });
  });
  const comparisonLineage = {
    ...lineage,
    excludedExchangeEntries:
      lineage.excludedExchangeEntries +
      rawExchangeEntries.length -
      exchangeEntries.length,
  };
  if (!exchangeEntries.length) {
    writeReplayComparisonReport(
      buildNoExchangeEntriesReport({
        connectorName,
        window: window!,
      }),
    );

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
    const emptyRowsByStrategy = new Map(
      buildExchangeComparisonRows({
        liveStrategySummaries,
        backtestEntries,
        matched: [],
        orderFailed: [],
        exchangeOnly: [],
        strategyNameByOrderLinkKey,
      }).map((row) => [row.strategyName, row]),
    );

    return {
      mode: 'exchange',
      syncedTradesCount: 0,
      windowTradesCount: 0,
      runtimeEntriesCount: 0,
      backtestEntriesCount: backtestEntries.length,
      matchedCount: 0,
      orderFailedCount: 0,
      runtimeOnlyCount: 0,
      backtestOnlyCount: backtestEntries.length,
      details,
      lineage: comparisonLineage,
      rows: liveStrategySummaries.map(
        ({ strategyName }) => emptyRowsByStrategy.get(strategyName)!,
      ),
    };
  }

  const comparison = compareExchangeEntriesToBacktest({
    exchangeEntries,
    backtestEntries,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
  });
  const { completed: matched, orderFailed } =
    splitExchangeMatchesByRuntimeOrderStatus({
      matched: comparison.matched,
      strategyNameByOrderLinkKey,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
      signalTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    });
  const details = buildReplayExchangeComparisonDetails({
    matched,
    orderFailed,
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

  const rows = buildExchangeComparisonRows({
    liveStrategySummaries,
    backtestEntries,
    matched,
    orderFailed,
    exchangeOnly: comparison.exchangeOnly,
    strategyNameByOrderLinkKey,
  });

  writeReplayComparisonReport(
    buildReplayComparisonReport({
      mode: 'exchange',
      connectorName,
      rows,
      details,
    }),
  );

  return {
    mode: 'exchange',
    syncedTradesCount: exchangeEntries.length,
    windowTradesCount: exchangeEntries.length,
    runtimeEntriesCount: exchangeEntries.length,
    backtestEntriesCount: backtestEntries.length,
    matchedCount: matched.length,
    orderFailedCount: orderFailed.length,
    runtimeOnlyCount: comparison.exchangeOnly.length,
    backtestOnlyCount: comparison.backtestOnly.length,
    rows,
    details,
    lineage: comparisonLineage,
  };
};

export const saveAndPrintReplayRuntimeComparison = async ({
  liveStrategySummaries,
  backtestEntries,
  replaySignals,
  replayLineages,
  runtimeEvidencePath,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
  replaySignals: Signal[];
  replayLineages: ReplayRuntimeLineageRecord[];
  runtimeEvidencePath?: string | null;
}): Promise<ReplayRuntimeComparisonSummary | null> => {
  const { connector, connectorName, window } = getRuntimeCompareContext();
  if (!connector || !window) {
    return null;
  }

  const relevantStrategies = new Set(
    liveStrategySummaries.map((summary) => summary.strategyName),
  );
  const replaySignalEvaluations = buildReplaySignalEvaluations(replaySignals);
  const runtimeEvidence = runtimeEvidencePath
    ? await loadReplayRuntimeEvidenceSource({
        filePath: runtimeEvidencePath,
        projectRoot: replayProjectRoot,
        expectedUserName: replayUserName,
        expectedWindow: window,
      })
    : null;
  const [
    rawRuntimeTrades,
    runtimeSignals,
    runtimeSignalEvaluations,
    runtimeLineageScopes,
  ] = runtimeEvidence
    ? [
        runtimeEvidence.trades,
        runtimeEvidence.signals,
        runtimeEvidence.evaluations,
        runtimeEvidence.lineageScopes,
      ]
    : await Promise.all([
        loadRuntimeTrades(replayUserName, {
          startTime: window.start,
          endTime: window.end,
        }),
        loadRuntimeSignals(replayUserName, {
          startTime: window.start,
          endTime: window.end,
        }),
        loadRuntimeSignalEvaluations(replayUserName, {
          startTime: window.start,
          endTime: window.end,
        }),
        loadRuntimeLineageScopes(replayUserName, {
          startTime: window.start,
          endTime: window.end,
        }),
      ]);
  if (runtimeEvidence) {
    console.log(
      chalk.gray(
        `runtime compare: using immutable evidence ${runtimeEvidence.path}`,
      ),
    );
  }
  const syncedRuntimeTrades = runtimeEvidence
    ? rawRuntimeTrades
    : await syncRuntimeTrades({
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
  const comparable = filterReplayComparisonByLineage({
    replayLineages,
    runtimeTrades: syncedRuntimeTrades,
    runtimeSignals,
    runtimeSignalEvaluations,
    runtimeLineageScopes,
    backtestEntries,
  });
  const comparableBacktestEntries = comparable.backtestEntries;
  const windowRuntimeTrades = comparable.runtimeTrades.filter(
    (trade) =>
      trade.entryTimestamp >= window.start &&
      trade.entryTimestamp < window.end &&
      relevantStrategies.has(trade.strategy),
  );

  if (!windowRuntimeTrades.length && !runtimeEvidence) {
    writeReplayComparisonReport(
      buildNoRuntimeTradesReport({ connectorName, window }),
    );
    return saveAndPrintReplayExchangeComparison({
      liveStrategySummaries,
      backtestEntries: comparableBacktestEntries,
      replaySignals,
      replaySignalEvaluations,
      runtimeSignals: comparable.runtimeSignals,
      runtimeSignalEvaluations: comparable.runtimeSignalEvaluations,
      lineage: comparable.lineage,
    });
  }

  const runtimeSummaries =
    summarizeRuntimeTradesByStrategy(windowRuntimeTrades);
  const rawRuntimeEntries = extractRuntimeParityEntries(windowRuntimeTrades);
  const runtimeDedupe = dedupeRuntimeParityEntries(rawRuntimeEntries);
  const comparison = compareTradeParityEntries({
    runtimeEntries: runtimeDedupe.entries,
    backtestEntries: comparableBacktestEntries,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
  });
  const details = buildReplayRuntimeComparisonDetails({
    matched: comparison.matched,
    runtimeOnly: comparison.runtimeOnly,
    backtestOnly: comparison.backtestOnly,
    runtimeEntries: runtimeDedupe.entries,
    backtestEntries: comparableBacktestEntries,
    toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
    backtestTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    runtimeSignals: comparable.runtimeSignals,
    runtimeSignalEvaluations: comparable.runtimeSignalEvaluations,
    replaySignals,
    replaySignalEvaluations,
  });
  const parityRows = summarizeTradeParityByStrategy({
    runtimeEntries: runtimeDedupe.entries,
    runtimeDuplicateEntries: runtimeDedupe.duplicateEntries,
    backtestEntries: comparableBacktestEntries,
    matchedEntries: comparison.matched,
    runtimeOnlyEntries: comparison.runtimeOnly,
    backtestOnlyEntries: comparison.backtestOnly,
  });
  const rows = buildRuntimeComparisonRows({
    liveStrategySummaries,
    runtimeSummaries,
    parityRows,
    backtestEntries: comparableBacktestEntries,
  });

  writeReplayComparisonReport(
    buildReplayComparisonReport({
      mode: 'runtime',
      connectorName,
      rows,
      details,
    }),
  );

  return {
    mode: 'runtime',
    syncedTradesCount: syncedRuntimeTrades.length,
    windowTradesCount: windowRuntimeTrades.length,
    runtimeEntriesCount: runtimeDedupe.entries.length,
    backtestEntriesCount: comparableBacktestEntries.length,
    matchedCount: comparison.matched.length,
    orderFailedCount: 0,
    runtimeOnlyCount: comparison.runtimeOnly.length,
    backtestOnlyCount: comparison.backtestOnly.length,
    rows,
    details,
    lineage: comparable.lineage,
  };
};
