import {
  normalizeStrategyOrderLinkKey,
  parseStrategyOrderLinkKey,
} from '@tradejs/core/trade';
import type { ExchangeEntryRecord } from '@tradejs/types';
import type { TradeParityEntry } from './runtimeParity';
import type {
  ReplayParityEntryDetail,
  ReplayParityNearestCandidate,
  ReplayRuntimeComparisonDetails,
} from './replay/support';

export type ExchangeMatchedBacktestEntry = {
  exchange: ExchangeEntryRecord;
  backtest: TradeParityEntry;
  timestampDiffMs: number;
  priceDeltaPct: number | null;
};

const DEFAULT_REPLAY_PARITY_DETAILS_LIMIT = 500;

export const buildStrategyNameByOrderLinkKey = (strategyNames: string[]) =>
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

const resolveReplayParityDetailsLimit = () => {
  const parsed = Number.parseInt(
    String(process.env.REPLAY_PARITY_DETAILS_LIMIT ?? ''),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_REPLAY_PARITY_DETAILS_LIMIT;
};

const capReplayDetails = <TItem>(items: TItem[], limit: number) =>
  items.slice(0, Math.max(0, limit));

const buildCostDetail = (entry: {
  entryFee?: number | null;
  exitFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
}) => ({
  entryFee: entry.entryFee ?? null,
  exitFee: entry.exitFee ?? null,
  fundingFee: entry.fundingFee ?? null,
  totalFee: entry.totalFee ?? null,
});

const toBacktestParityDetail = (
  entry: TradeParityEntry,
): ReplayParityEntryDetail => ({
  source: 'backtest',
  strategy: entry.strategy,
  symbol: entry.symbol,
  direction: entry.direction,
  qty: entry.qty ?? null,
  timestamp: entry.timestamp,
  price: entry.price,
  exitType: entry.exitType ?? null,
  exitTimestamp: entry.exitTimestamp ?? null,
  exitPrice: entry.exitPrice ?? null,
  pnl: entry.expectedPnl ?? null,
  costs: buildCostDetail(entry),
  orderId: entry.orderId,
  signalId: entry.signalId,
});

const toRuntimeParityDetail = (
  entry: TradeParityEntry,
): ReplayParityEntryDetail => ({
  source: 'runtime',
  strategy: entry.strategy,
  symbol: entry.symbol,
  direction: entry.direction,
  qty: entry.qty ?? null,
  timestamp: entry.timestamp,
  price: entry.price,
  exitType: entry.exitType ?? null,
  exitTimestamp: entry.exitTimestamp ?? null,
  exitPrice: entry.exitPrice ?? null,
  pnl: entry.realizedPnl ?? null,
  costs: buildCostDetail(entry),
  orderId: entry.orderId,
  signalId: entry.signalId,
});

const toExchangeParityDetail = ({
  entry,
  inferredStrategy = null,
}: {
  entry: ExchangeEntryRecord;
  inferredStrategy?: string | null;
}): ReplayParityEntryDetail => ({
  source: 'exchange',
  inferredStrategy,
  symbol: entry.symbol,
  direction: entry.direction,
  qty: entry.qty,
  timestamp: entry.entryTimestamp,
  price: entry.entryPrice,
  exitType: null,
  exitTimestamp: entry.exitTimestamp ?? null,
  exitPrice: entry.exitPrice ?? null,
  pnl: entry.closedPnl ?? null,
  costs: buildCostDetail({
    entryFee: entry.openFee,
    exitFee: entry.closeFee,
    fundingFee: entry.fundingFee,
    totalFee: entry.totalFee,
  }),
  orderId: entry.orderId,
  orderLinkId: entry.orderLinkId,
});

const buildTimestampDelta = (
  left: number | null | undefined,
  right: number | null | undefined,
) =>
  typeof left === 'number' &&
  Number.isFinite(left) &&
  typeof right === 'number' &&
  Number.isFinite(right)
    ? Math.abs(left - right)
    : null;

const buildPnlDelta = (
  expectedPnl: number | null | undefined,
  realizedPnl: number | null | undefined,
) =>
  typeof expectedPnl === 'number' &&
  Number.isFinite(expectedPnl) &&
  typeof realizedPnl === 'number' &&
  Number.isFinite(realizedPnl)
    ? realizedPnl - expectedPnl
    : null;

const buildPriceDeltaPct = (
  leftPrice: number | null | undefined,
  rightPrice: number | null | undefined,
): number | null => {
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

const buildSlippageCost = ({
  direction,
  expectedPrice,
  actualPrice,
  qty,
  stage,
}: {
  direction: string;
  expectedPrice: number | null | undefined;
  actualPrice: number | null | undefined;
  qty: number | null | undefined;
  stage: 'entry' | 'exit';
}) => {
  if (
    typeof expectedPrice !== 'number' ||
    !Number.isFinite(expectedPrice) ||
    typeof actualPrice !== 'number' ||
    !Number.isFinite(actualPrice) ||
    typeof qty !== 'number' ||
    !Number.isFinite(qty)
  ) {
    return null;
  }

  const sideMultiplier = direction === 'SHORT' ? -1 : 1;
  const priceDelta =
    stage === 'entry'
      ? (actualPrice - expectedPrice) * sideMultiplier
      : (expectedPrice - actualPrice) * sideMultiplier;
  return Number((priceDelta * qty).toFixed(12));
};

const buildMatchedReplayDetail = ({
  runtime,
  backtest,
  timestampDiffMs,
  priceDeltaPct,
}: {
  runtime: ReplayParityEntryDetail;
  backtest: ReplayParityEntryDetail;
  timestampDiffMs: number;
  priceDeltaPct: number | null;
}) => {
  const exitPriceDeltaPct = buildPriceDeltaPct(
    runtime.exitPrice ?? null,
    backtest.exitPrice ?? null,
  );
  const qty = runtime.qty ?? backtest.qty ?? null;
  const entrySlippageCost = buildSlippageCost({
    direction: runtime.direction,
    expectedPrice: backtest.price,
    actualPrice: runtime.price,
    qty,
    stage: 'entry',
  });
  const exitSlippageCost = buildSlippageCost({
    direction: runtime.direction,
    expectedPrice: backtest.exitPrice,
    actualPrice: runtime.exitPrice,
    qty,
    stage: 'exit',
  });
  const totalSlippageCost =
    entrySlippageCost == null && exitSlippageCost == null
      ? null
      : Number(
          ((entrySlippageCost ?? 0) + (exitSlippageCost ?? 0)).toFixed(12),
        );
  return {
    runtime,
    backtest,
    timestampDiffMs,
    priceDeltaPct,
    exitTimestampDiffMs: buildTimestampDelta(
      runtime.exitTimestamp,
      backtest.exitTimestamp,
    ),
    exitPriceDeltaPct,
    exitType: {
      expected: backtest.exitType ?? null,
      actual: runtime.exitType ?? null,
      matches:
        backtest.exitType && runtime.exitType
          ? backtest.exitType === runtime.exitType
          : null,
    },
    pnl: {
      expectedPnl: backtest.pnl ?? null,
      realizedPnl: runtime.pnl ?? null,
      delta: buildPnlDelta(backtest.pnl, runtime.pnl),
    },
    slippage: {
      entryPriceDeltaPct: priceDeltaPct,
      exitPriceDeltaPct,
      entryCost: entrySlippageCost,
      exitCost: exitSlippageCost,
      totalCost: totalSlippageCost,
    },
  };
};

const buildNearestCandidates = ({
  entries,
  candidates,
  toleranceMs,
  requireSameStrategy,
}: {
  entries: ReplayParityEntryDetail[];
  candidates: ReplayParityEntryDetail[];
  toleranceMs: number;
  requireSameStrategy?: boolean;
}): ReplayParityNearestCandidate[] =>
  entries.map((entry) => {
    const comparable = candidates.filter((candidate) => {
      if (
        candidate.symbol !== entry.symbol ||
        candidate.direction !== entry.direction
      ) {
        return false;
      }
      if (!requireSameStrategy) {
        return true;
      }
      const entryStrategy = entry.strategy ?? entry.inferredStrategy ?? null;
      const candidateStrategy =
        candidate.strategy ?? candidate.inferredStrategy ?? null;
      return entryStrategy != null && entryStrategy === candidateStrategy;
    });

    const nearest = comparable
      .map((candidate) => ({
        candidate,
        timestampDiffMs: Math.abs(candidate.timestamp - entry.timestamp),
      }))
      .sort((left, right) => left.timestampDiffMs - right.timestampDiffMs)[0];

    if (!nearest) {
      return {
        entry,
        nearest: null,
        timestampDiffMs: null,
        priceDeltaPct: null,
        reason: 'no_candidate_same_symbol_direction',
      };
    }

    const priceDeltaPct = buildPriceDeltaPct(
      entry.price,
      nearest.candidate.price,
    );
    return {
      entry,
      nearest: nearest.candidate,
      timestampDiffMs: nearest.timestampDiffMs,
      priceDeltaPct,
      reason:
        nearest.timestampDiffMs > toleranceMs
          ? 'outside_tolerance'
          : 'candidate_already_matched',
    };
  });

export const buildReplayRuntimeComparisonDetails = ({
  matched,
  runtimeOnly,
  backtestOnly,
  runtimeEntries,
  backtestEntries,
  toleranceMs,
  limit = resolveReplayParityDetailsLimit(),
}: {
  matched: Array<{
    runtime: TradeParityEntry;
    backtest: TradeParityEntry;
    timestampDiffMs: number;
    priceDeltaPct: number | null;
  }>;
  runtimeOnly: TradeParityEntry[];
  backtestOnly: TradeParityEntry[];
  runtimeEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
  limit?: number;
}): ReplayRuntimeComparisonDetails => {
  const runtimeDetails = runtimeEntries.map(toRuntimeParityDetail);
  const backtestDetails = backtestEntries.map(toBacktestParityDetail);
  const runtimeOnlyDetails = runtimeOnly.map(toRuntimeParityDetail);
  const backtestOnlyDetails = backtestOnly.map(toBacktestParityDetail);
  const nearestCandidates = [
    ...buildNearestCandidates({
      entries: runtimeOnlyDetails,
      candidates: backtestDetails,
      toleranceMs,
      requireSameStrategy: true,
    }),
    ...buildNearestCandidates({
      entries: backtestOnlyDetails,
      candidates: runtimeDetails,
      toleranceMs,
      requireSameStrategy: true,
    }),
  ];

  return {
    capped:
      matched.length > limit ||
      runtimeOnlyDetails.length > limit ||
      backtestOnlyDetails.length > limit ||
      nearestCandidates.length > limit,
    limit,
    matched: capReplayDetails(
      matched.map((item) =>
        buildMatchedReplayDetail({
          runtime: toRuntimeParityDetail(item.runtime),
          backtest: toBacktestParityDetail(item.backtest),
          timestampDiffMs: item.timestampDiffMs,
          priceDeltaPct: item.priceDeltaPct,
        }),
      ),
      limit,
    ),
    runtimeOnly: capReplayDetails(runtimeOnlyDetails, limit),
    backtestOnly: capReplayDetails(backtestOnlyDetails, limit),
    nearestCandidates: capReplayDetails(nearestCandidates, limit),
  };
};

export const buildReplayExchangeComparisonDetails = ({
  matched,
  exchangeOnly,
  backtestOnly,
  exchangeEntries,
  backtestEntries,
  strategyNameByOrderLinkKey,
  toleranceMs,
  limit = resolveReplayParityDetailsLimit(),
}: {
  matched: ExchangeMatchedBacktestEntry[];
  exchangeOnly: ExchangeEntryRecord[];
  backtestOnly: TradeParityEntry[];
  exchangeEntries: ExchangeEntryRecord[];
  backtestEntries: TradeParityEntry[];
  strategyNameByOrderLinkKey: Map<string, string>;
  toleranceMs: number;
  limit?: number;
}): ReplayRuntimeComparisonDetails => {
  const toExchangeDetail = (entry: ExchangeEntryRecord) =>
    toExchangeParityDetail({
      entry,
      inferredStrategy: resolveReplayStrategyNameFromExchangeEntry({
        exchangeEntry: entry,
        strategyNameByOrderLinkKey,
      }),
    });
  const exchangeDetails = exchangeEntries.map(toExchangeDetail);
  const backtestDetails = backtestEntries.map(toBacktestParityDetail);
  const exchangeOnlyDetails = exchangeOnly.map(toExchangeDetail);
  const backtestOnlyDetails = backtestOnly.map(toBacktestParityDetail);
  const nearestCandidates = [
    ...buildNearestCandidates({
      entries: exchangeOnlyDetails,
      candidates: backtestDetails,
      toleranceMs,
    }),
    ...buildNearestCandidates({
      entries: backtestOnlyDetails,
      candidates: exchangeDetails,
      toleranceMs,
    }),
  ];

  return {
    capped:
      matched.length > limit ||
      exchangeOnlyDetails.length > limit ||
      backtestOnlyDetails.length > limit ||
      nearestCandidates.length > limit,
    limit,
    matched: capReplayDetails(
      matched.map((item) =>
        buildMatchedReplayDetail({
          runtime: toExchangeDetail(item.exchange),
          backtest: toBacktestParityDetail(item.backtest),
          timestampDiffMs: item.timestampDiffMs,
          priceDeltaPct: item.priceDeltaPct,
        }),
      ),
      limit,
    ),
    runtimeOnly: capReplayDetails(exchangeOnlyDetails, limit),
    backtestOnly: capReplayDetails(backtestOnlyDetails, limit),
    nearestCandidates: capReplayDetails(nearestCandidates, limit),
  };
};
