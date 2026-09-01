import type {
  ExchangeEntryRecord,
  RuntimeLineage,
  RuntimeSignalEvaluationRecord,
  RuntimeTradeRecord,
  Signal,
} from '@tradejs/types';
import {
  getBacktestParityComparisonTimestamp,
  type TradeParityEntry,
} from '../runtimeParity';
import {
  resolveReplayStrategyNameFromExchangeEntry,
  type ExchangeMatchedBacktestEntry,
  type ExchangeOrderFailedBacktestEntry,
} from '../runtimeParityDetails';
import {
  runtimeLineageKey,
  runtimeLineagesComparable,
} from '../runtimeLineage';
import type { RuntimeLineageScopeRecord } from '../runtimeSignalsStorage';
import type { ReplayRuntimeLineageRecord } from './historicalSignalsReplay';
import type {
  ReplayRuntimeComparisonSummary,
  ReplayRuntimeParityRow,
  ReplayStrategySummary,
} from './support';

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

export type ComparableLineageArtifacts = {
  runtimeTrades: RuntimeTradeRecord[];
  runtimeSignals: Signal[];
  runtimeSignalEvaluations: RuntimeSignalEvaluationRecord[];
  runtimeLineageScopes: RuntimeLineageScopeRecord[];
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
      lineageScopeKey({ strategy, symbol, deploymentId, accountId }),
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
  const comparableBacktestEntries: TradeParityEntry[] = [];
  const excludedBacktestEntryDetails: NonNullable<
    ReplayRuntimeComparisonSummary['lineage']['excludedBacktestEntryDetails']
  > = [];
  for (const entry of backtestEntries) {
    const replayScope = replayScopeByStrategySymbol.get(
      `${entry.strategy}::${entry.symbol}`,
    );
    const window = replayScope ? deploymentWindows.get(replayScope) : null;
    const signalTimestamp = entry.signalTimestamp ?? entry.timestamp;
    if (
      window != null &&
      signalTimestamp >= window.firstTimestamp &&
      signalTimestamp <= window.lastTimestamp
    ) {
      comparableBacktestEntries.push(entry);
      continue;
    }

    const reason = !replayScope
      ? 'replay_scope_missing'
      : !window
        ? 'runtime_scope_missing'
        : signalTimestamp < window.firstTimestamp
          ? 'before_runtime_window'
          : 'after_runtime_window';
    excludedBacktestEntryDetails.push({
      id: entry.id,
      strategy: entry.strategy,
      symbol: entry.symbol,
      direction: entry.direction,
      ...(entry.qty != null ? { qty: entry.qty } : {}),
      timestamp: entry.timestamp,
      ...(entry.signalTimestamp != null
        ? { signalTimestamp: entry.signalTimestamp }
        : {}),
      price: entry.price,
      ...(entry.orderId ? { orderId: entry.orderId } : {}),
      ...(entry.signalId ? { signalId: entry.signalId } : {}),
      ...(entry.expectedPnl != null ? { expectedPnl: entry.expectedPnl } : {}),
      reason,
      runtimeWindow: window ?? null,
    });
  }
  const comparableScopeKeys = new Set(deploymentWindows.keys());

  return {
    runtimeTrades: comparableRuntimeTrades,
    runtimeSignals: comparableRuntimeSignals,
    runtimeSignalEvaluations: comparableRuntimeEvaluations,
    runtimeLineageScopes: comparableRuntimeLineageScopes,
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
      excludedBacktestEntryDetails,
      reason:
        comparableScopeKeys.size > 0
          ? null
          : expectedByScope.size === 0
            ? 'replay_produced_no_lineage_scopes'
            : 'no_runtime_artifacts_with_matching_lineage',
      replay: [...expectedByScope.entries()]
        .map(([scope, lineage]) => {
          const [deploymentId, accountId, strategy, symbol] = scope.split('::');
          return { deploymentId, accountId, strategy, symbol, lineage };
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
    const unmatchedBacktest = [...(groupedBacktest.get(key) ?? [])]
      .sort((left, right) => left.timestamp - right.timestamp)
      .map((entry) => ({ entry, used: false }));

    for (const exchangeEntry of exchangeGroup) {
      let bestIndex = -1;
      let bestDiff = Number.POSITIVE_INFINITY;
      for (let index = 0; index < unmatchedBacktest.length; index += 1) {
        const candidate = unmatchedBacktest[index];
        if (candidate.used) continue;
        const diff = Math.abs(
          getBacktestParityComparisonTimestamp(
            candidate.entry,
            backtestTimestampOffsetMs,
          ) - exchangeEntry.entryTimestamp,
        );
        if (diff > toleranceMs || diff >= bestDiff) continue;
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
    if (!matchedBacktestEntries.has(entry)) backtestOnly.push(entry);
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

  return { matched, exchangeOnly, backtestOnly };
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

export const hasLineageLinkedRuntimeOutcome = ({
  exchangeEntry,
  strategyName,
  runtimeSignals,
  runtimeSignalEvaluations,
  toleranceMs,
  signalTimestampOffsetMs,
}: Parameters<typeof findExchangeRuntimeOutcome>[0]) =>
  findExchangeRuntimeOutcome({
    exchangeEntry,
    strategyName,
    runtimeSignals,
    runtimeSignalEvaluations,
    toleranceMs,
    signalTimestampOffsetMs,
  }) != null;

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
    if (!strategyName) return true;
    const outcome = findExchangeRuntimeOutcome({
      exchangeEntry: item.exchange,
      strategyName,
      runtimeSignals,
      runtimeSignalEvaluations,
      toleranceMs,
      signalTimestampOffsetMs,
    });
    if (outcome?.orderStatus !== 'failed') return true;
    orderFailed.push({
      ...item,
      reason: outcome.reason || 'orderStatus=failed',
    });
    return false;
  });

  return { completed, orderFailed };
};

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

export const buildExchangeComparisonRows = ({
  liveStrategySummaries,
  backtestEntries,
  matched,
  orderFailed,
  exchangeOnly,
  strategyNameByOrderLinkKey,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  backtestEntries: TradeParityEntry[];
  matched: ExchangeMatchedBacktestEntry[];
  orderFailed: ExchangeOrderFailedBacktestEntry[];
  exchangeOnly: ExchangeEntryRecord[];
  strategyNameByOrderLinkKey: Map<string, string>;
}): ReplayRuntimeParityRow[] => {
  const backtestPnlByStrategy = summarizeBacktestPnlByStrategy(backtestEntries);
  const rowByStrategy = new Map<string, ReplayRuntimeParityRow>();
  const ensureRow = (strategyName: string) => {
    const existing = rowByStrategy.get(strategyName);
    if (existing) return existing;
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

  for (const summary of liveStrategySummaries) ensureRow(summary.strategyName);
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
  const matchedBacktestEntries = new Set([
    ...matched.map(({ backtest }) => backtest),
    ...orderFailed.map(({ backtest }) => backtest),
  ]);
  for (const entry of backtestEntries) {
    if (!matchedBacktestEntries.has(entry)) {
      ensureRow(entry.strategy).backtestOnly += 1;
    }
  }
  for (const entry of exchangeOnly) {
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

  return [...rowByStrategy.values()]
    .map((row) => ({
      ...row,
      runtimePnl: Number(row.runtimePnl.toFixed(2)),
    }))
    .sort((left, right) => left.strategyName.localeCompare(right.strategyName));
};

export const buildRuntimeComparisonRows = ({
  liveStrategySummaries,
  runtimeSummaries,
  parityRows,
  backtestEntries,
}: {
  liveStrategySummaries: ReplayStrategySummary[];
  runtimeSummaries: Array<{
    strategyName: string;
    trades: number;
    totalPnl: number;
  }>;
  parityRows: Array<
    [
      string,
      {
        backtest: number;
        matched: number;
        runtimeOnly: number;
        backtestOnly: number;
      },
    ]
  >;
  backtestEntries: TradeParityEntry[];
}): ReplayRuntimeParityRow[] => {
  const runtimeSummaryByStrategy = new Map(
    runtimeSummaries.map((summary) => [summary.strategyName, summary]),
  );
  const parityByStrategy = new Map(parityRows);
  const backtestPnlByStrategy = summarizeBacktestPnlByStrategy(backtestEntries);
  const strategyNames = new Set<string>([
    ...liveStrategySummaries.map(({ strategyName }) => strategyName),
    ...runtimeSummaryByStrategy.keys(),
    ...parityByStrategy.keys(),
  ]);

  return [...strategyNames]
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
};
