import chalk from 'chalk';
import { formatUnix } from '@tradejs/core/time';
import type {
  Connector,
  ExchangeEntryRecord,
  RuntimeLineage,
  RuntimeTradeRecord,
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
  loadRuntimeLineageScopes,
  loadRuntimeSignalEvaluations,
  loadRuntimeSignals,
} from '../runtimeSignalsLoader';
import type { RuntimeLineageScopeRecord } from '../runtimeSignalsStorage';
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
  type ExchangeOrderFailedBacktestEntry,
} from '../runtimeParityDetails';
import { getRuntimeCompareContext } from '../backtest/runState';
import { replayInterval, replayProjectRoot, replayUserName } from './cliConfig';
import { loadReplayRuntimeEvidenceSource } from './runtimeEvidenceSource';
import {
  REPLAY_RUNTIME_COMPARISON_HEADERS,
  REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
  formatReplayRuntimeCompareTolerance,
  getReplayRuntimeUnmatchedCount,
  type ReplayRuntimeComparisonSummary,
  type ReplayRuntimeParityRow,
  type ReplayStrategySummary,
} from './support';
import {
  runtimeLineagesComparable,
  runtimeLineageKey,
} from '../runtimeLineage';
import type { ReplayRuntimeLineageRecord } from './historicalSignalsReplay';

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

const lineageScopeKey = ({
  strategy,
  symbol,
  deploymentId,
  accountId,
}: {
  strategy: string;
  symbol: string;
  deploymentId?: string;
  accountId?: string;
}) =>
  `${deploymentId ?? 'default-deployment'}::${accountId ?? 'default-account'}::${strategy}::${symbol}`;

type ComparableLineageArtifacts = {
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  backtestEntries: TradeParityEntry[];
  lineage: ReplayRuntimeComparisonSummary['lineage'];
};

const buildExpectedLineageByScope = (
  replayLineages: ReplayRuntimeLineageRecord[],
) =>
  new Map(
    replayLineages.map((record) => [lineageScopeKey(record), record.lineage]),
  );

const hasExpectedLineage = ({
  strategy,
  symbol,
  deploymentId,
  accountId,
  lineage,
  expectedByScope,
}: {
  strategy: string;
  symbol: string;
  deploymentId?: string;
  accountId?: string;
  lineage?: RuntimeLineage;
  expectedByScope: Map<string, RuntimeLineage>;
}) =>
  runtimeLineagesComparable(
    lineage,
    expectedByScope.get(
      lineageScopeKey({
        strategy,
        symbol,
        deploymentId,
        accountId,
      }),
    ),
  );

export const filterReplayComparisonByLineage = ({
  replayLineages,
  runtimeTrades,
  runtimeSignals,
  runtimeSignalEvaluations,
  runtimeLineageScopes,
  backtestEntries,
}: {
  replayLineages: ReplayRuntimeLineageRecord[];
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  runtimeLineageScopes: RuntimeLineageScopeRecord[];
  backtestEntries: TradeParityEntry[];
}): ComparableLineageArtifacts => {
  const expectedByScope = buildExpectedLineageByScope(replayLineages);
  const comparableRuntimeSignals = runtimeSignals.filter((signal) =>
    hasExpectedLineage({
      strategy: signal.strategy,
      symbol: signal.symbol,
      deploymentId: signal.deploymentId,
      accountId: signal.accountId,
      lineage: signal.runtimeLineage,
      expectedByScope,
    }),
  );
  const comparableRuntimeEvaluations = runtimeSignalEvaluations.filter(
    (evaluation) =>
      hasExpectedLineage({
        strategy: evaluation.strategy,
        symbol: evaluation.symbol,
        deploymentId: evaluation.deploymentId,
        accountId: evaluation.accountId,
        lineage: evaluation.runtimeLineage,
        expectedByScope,
      }),
  );
  const comparableRuntimeLineageScopes = runtimeLineageScopes.filter((scope) =>
    hasExpectedLineage({
      strategy: scope.strategy,
      symbol: scope.symbol,
      deploymentId: scope.deploymentId,
      accountId: scope.accountId,
      lineage: scope.lineage,
      expectedByScope,
    }),
  );
  const deploymentWindows = new Map<
    string,
    { firstTimestamp: number; lastTimestamp: number }
  >();
  for (const scope of comparableRuntimeLineageScopes) {
    const key = lineageScopeKey(scope);
    const existing = deploymentWindows.get(key);
    deploymentWindows.set(key, {
      firstTimestamp:
        existing == null
          ? scope.firstTimestamp
          : Math.min(existing.firstTimestamp, scope.firstTimestamp),
      lastTimestamp:
        existing == null
          ? scope.lastTimestamp
          : Math.max(existing.lastTimestamp, scope.lastTimestamp),
    });
  }
  const lineageBySignalId = new Map<string, RuntimeLineage>();
  for (const signal of runtimeSignals) {
    if (signal.runtimeLineage) {
      lineageBySignalId.set(signal.signalId, signal.runtimeLineage);
    }
  }
  for (const evaluation of runtimeSignalEvaluations) {
    if (evaluation.signalId && evaluation.runtimeLineage) {
      lineageBySignalId.set(evaluation.signalId, evaluation.runtimeLineage);
    }
  }
  const comparableRuntimeTrades = runtimeTrades.filter((trade) => {
    const lineage = trade.signalId
      ? lineageBySignalId.get(trade.signalId)
      : undefined;
    if (lineage) {
      return hasExpectedLineage({
        strategy: trade.strategy,
        symbol: trade.symbol,
        deploymentId: trade.deploymentId,
        accountId: trade.accountId,
        lineage,
        expectedByScope,
      });
    }
    const window = deploymentWindows.get(lineageScopeKey(trade));
    const signalTimestamp = trade.signalTimestamp ?? trade.entryTimestamp;
    return (
      window != null &&
      signalTimestamp >= window.firstTimestamp &&
      signalTimestamp <= window.lastTimestamp
    );
  });

  for (const artifact of [
    ...comparableRuntimeSignals,
    ...comparableRuntimeEvaluations,
  ]) {
    const key = lineageScopeKey(artifact);
    const existing = deploymentWindows.get(key);
    deploymentWindows.set(key, {
      firstTimestamp:
        existing == null
          ? artifact.timestamp
          : Math.min(existing.firstTimestamp, artifact.timestamp),
      lastTimestamp:
        existing == null
          ? artifact.timestamp
          : Math.max(existing.lastTimestamp, artifact.timestamp),
    });
  }

  const replayScopeByStrategySymbol = new Map(
    replayLineages.map((record) => [
      `${record.strategy}::${record.symbol}`,
      lineageScopeKey(record),
    ]),
  );
  const comparableBacktestEntries = backtestEntries.filter((entry) => {
    const replayScope = replayScopeByStrategySymbol.get(
      `${entry.strategy}::${entry.symbol}`,
    );
    const window = replayScope ? deploymentWindows.get(replayScope) : null;
    const signalTimestamp = entry.signalTimestamp ?? entry.timestamp;
    return (
      window != null &&
      signalTimestamp >= window.firstTimestamp &&
      signalTimestamp <= window.lastTimestamp
    );
  });
  const comparableScopeKeys = new Set(deploymentWindows.keys());

  return {
    runtimeTrades: comparableRuntimeTrades,
    runtimeSignals: comparableRuntimeSignals,
    runtimeSignalEvaluations: comparableRuntimeEvaluations,
    backtestEntries: comparableBacktestEntries,
    lineage: {
      enforced: true,
      replayScopes: expectedByScope.size,
      comparableScopes: comparableScopeKeys.size,
      excludedRuntimeTrades:
        runtimeTrades.length - comparableRuntimeTrades.length,
      excludedRuntimeSignals:
        runtimeSignals.length - comparableRuntimeSignals.length,
      excludedRuntimeEvaluations:
        runtimeSignalEvaluations.length - comparableRuntimeEvaluations.length,
      excludedRuntimeLineageScopes:
        runtimeLineageScopes.length - comparableRuntimeLineageScopes.length,
      excludedExchangeEntries: 0,
      excludedBacktestEntries:
        backtestEntries.length - comparableBacktestEntries.length,
      reason:
        comparableScopeKeys.size > 0
          ? null
          : 'no_runtime_artifacts_with_matching_lineage',
      replay: [...expectedByScope.entries()]
        .map(([scope, lineage]) => {
          const [deploymentId, accountId, strategy, symbol] = scope.split('::');
          return {
            deploymentId,
            accountId,
            strategy,
            symbol,
            lineage,
          };
        })
        .sort(
          (left, right) =>
            left.strategy.localeCompare(right.strategy) ||
            left.symbol.localeCompare(right.symbol) ||
            runtimeLineageKey(left.lineage).localeCompare(
              runtimeLineageKey(right.lineage),
            ),
        ),
    },
  };
};

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

const summarizeBacktestPnlByStrategy = (entries: TradeParityEntry[]) => {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const pnl =
      typeof entry.expectedPnl === 'number' &&
      Number.isFinite(entry.expectedPnl)
        ? entry.expectedPnl
        : 0;
    totals.set(entry.strategy, (totals.get(entry.strategy) ?? 0) + pnl);
  }
  return totals;
};

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

const findExchangeRuntimeOutcome = ({
  exchangeEntry,
  strategyName,
  runtimeSignals,
  runtimeSignalEvaluations,
  toleranceMs,
  signalTimestampOffsetMs,
}: {
  exchangeEntry: ExchangeEntryRecord;
  strategyName: string;
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
  signalTimestampOffsetMs: number;
}) => {
  const candidates: Array<{
    timestamp: number;
    orderStatus?: string;
    reason?: string;
  }> = [];
  for (const signal of runtimeSignals) {
    if (
      signal.strategy === strategyName &&
      signal.symbol === exchangeEntry.symbol &&
      signal.direction === exchangeEntry.direction
    ) {
      candidates.push({
        timestamp: signal.timestamp,
        orderStatus: signal.orderStatus,
        reason:
          signal.orderFailureReason ||
          signal.orderSkipReason ||
          signal.orderStatus,
      });
    }
  }
  for (const evaluation of runtimeSignalEvaluations) {
    if (
      evaluation.strategy === strategyName &&
      evaluation.symbol === exchangeEntry.symbol &&
      (evaluation.direction == null ||
        evaluation.direction === exchangeEntry.direction)
    ) {
      candidates.push({
        timestamp: evaluation.timestamp,
        orderStatus: evaluation.orderStatus,
        reason:
          evaluation.orderSkipReason ||
          evaluation.reason ||
          evaluation.orderStatus,
      });
    }
  }

  return (
    candidates
      .map((candidate) => ({
        ...candidate,
        timestampDiffMs: Math.abs(
          candidate.timestamp +
            signalTimestampOffsetMs -
            exchangeEntry.entryTimestamp,
        ),
      }))
      .filter((candidate) => candidate.timestampDiffMs <= toleranceMs)
      .sort(
        (left, right) =>
          left.timestampDiffMs - right.timestampDiffMs ||
          Number(right.orderStatus === 'failed') -
            Number(left.orderStatus === 'failed'),
      )[0] ?? null
  );
};

export const splitExchangeMatchesByRuntimeOrderStatus = ({
  matched,
  strategyNameByOrderLinkKey,
  runtimeSignals,
  runtimeSignalEvaluations,
  toleranceMs,
  signalTimestampOffsetMs,
}: {
  matched: ExchangeMatchedBacktestEntry[];
  strategyNameByOrderLinkKey: Map<string, string>;
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  toleranceMs: number;
  signalTimestampOffsetMs: number;
}) => {
  const orderFailed: ExchangeOrderFailedBacktestEntry[] = [];
  const completed = matched.filter((item) => {
    const strategyName = resolveReplayStrategyNameFromExchangeEntry({
      exchangeEntry: item.exchange,
      strategyNameByOrderLinkKey,
    });
    if (!strategyName) {
      return true;
    }
    const outcome = findExchangeRuntimeOutcome({
      exchangeEntry: item.exchange,
      strategyName,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs,
      signalTimestampOffsetMs,
    });
    if (outcome?.orderStatus !== 'failed') {
      return true;
    }
    orderFailed.push({
      ...item,
      reason: outcome.reason || 'orderStatus=failed',
    });
    return false;
  });

  return { completed, orderFailed };
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
  const exchangeOutcomeByEntry = new Map<
    ExchangeEntryRecord,
    ReturnType<typeof findExchangeRuntimeOutcome>
  >();
  const exchangeEntries = rawExchangeEntries.filter((entry) => {
    const strategyName = resolveReplayStrategyNameFromExchangeEntry({
      exchangeEntry: entry,
      strategyNameByOrderLinkKey,
    });
    if (!strategyName) {
      return false;
    }
    const outcome = findExchangeRuntimeOutcome({
      exchangeEntry: entry,
      strategyName,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
      signalTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    });
    exchangeOutcomeByEntry.set(entry, outcome);
    return outcome != null;
  });
  const comparisonLineage = {
    ...lineage,
    excludedExchangeEntries:
      lineage.excludedExchangeEntries +
      rawExchangeEntries.length -
      exchangeEntries.length,
  };
  const backtestPnlByStrategy = summarizeBacktestPnlByStrategy(backtestEntries);

  if (!exchangeEntries.length) {
    console.log('');
    console.log(
      chalk.yellow(
        `SIGNALS REPLAY VS EXCHANGE: no lineage-linked exchange entry executions found for ${connectorName} in ${formatUnix(
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
      orderFailedCount: 0,
      runtimeOnlyCount: 0,
      backtestOnlyCount: backtestEntries.length,
      details,
      lineage: comparisonLineage,
      rows: liveStrategySummaries.map((summary) => ({
        strategyName: summary.strategyName,
        backtestEntries: backtestEntries.filter(
          (entry) => entry.strategy === summary.strategyName,
        ).length,
        backtestNetProfit: backtestPnlByStrategy.get(summary.strategyName) ?? 0,
        runtimeTrades: 0,
        runtimePnl: 0,
        matched: 0,
        orderFailed: 0,
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
  const { completed: matched, orderFailed } =
    splitExchangeMatchesByRuntimeOrderStatus({
      matched: comparison.matched,
      strategyNameByOrderLinkKey,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs: REPLAY_RUNTIME_COMPARE_TOLERANCE_MS,
      signalTimestampOffsetMs: getReplayEntryTimestampCompareOffsetMs(),
    });
  const rowByStrategy = new Map<string, ReplayRuntimeParityRow>();
  const ensureRow = (strategyName: string) => {
    const existing = rowByStrategy.get(strategyName);
    if (existing) {
      return existing;
    }

    const next: ReplayRuntimeParityRow = {
      strategyName,
      backtestEntries: 0,
      backtestNetProfit: backtestPnlByStrategy.get(strategyName) ?? 0,
      runtimeTrades: 0,
      runtimePnl: 0,
      matched: 0,
      orderFailed: 0,
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

  for (const item of matched) {
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
  for (const item of orderFailed) {
    const row = ensureRow(item.backtest.strategy);
    row.runtimeTrades += 1;
    row.orderFailed += 1;
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
      chalk.red(String(row.orderFailed)),
      chalk.yellow(String(row.runtimeOnly)),
      chalk.magenta(String(row.backtestOnly)),
      chalk.red(String(getReplayRuntimeUnmatchedCount(row))),
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
    console.log('');
    console.log(
      chalk.yellow(
        `SIGNALS REPLAY VS RUNTIME: no local runtime trades found for ${connectorName} in ${formatUnix(
          window.start,
        )} -> ${formatUnix(window.end)} with matching lineage; checking lineage-linked exchange executions`,
      ),
    );
    console.log('');
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
  const runtimeSummaryByStrategy = new Map(
    runtimeSummaries.map((summary) => [summary.strategyName, summary]),
  );
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
  const parityByStrategy = new Map(parityRows);
  const liveSummaryByStrategy = new Map(
    liveStrategySummaries.map((summary) => [summary.strategyName, summary]),
  );
  const backtestPnlByStrategy = summarizeBacktestPnlByStrategy(
    comparableBacktestEntries,
  );

  const strategyNames = new Set<string>([
    ...liveSummaryByStrategy.keys(),
    ...runtimeSummaryByStrategy.keys(),
    ...parityByStrategy.keys(),
  ]);
  const rows = [...strategyNames]
    .sort((left, right) => left.localeCompare(right))
    .map((strategyName) => {
      const runtimeSummary = runtimeSummaryByStrategy.get(strategyName);
      const parity = parityByStrategy.get(strategyName);

      return {
        strategyName,
        backtestEntries: parity?.backtest ?? 0,
        backtestNetProfit: backtestPnlByStrategy.get(strategyName) ?? 0,
        runtimeTrades: runtimeSummary?.trades ?? 0,
        runtimePnl: runtimeSummary?.totalPnl ?? 0,
        matched: parity?.matched ?? 0,
        orderFailed: 0,
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
      chalk.red(String(row.orderFailed)),
      chalk.yellow(String(row.runtimeOnly)),
      chalk.magenta(String(row.backtestOnly)),
      chalk.red(String(getReplayRuntimeUnmatchedCount(row))),
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
