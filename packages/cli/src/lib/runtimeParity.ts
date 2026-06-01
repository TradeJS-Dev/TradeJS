import { Direction, OrderLogData, RuntimeTradeRecord } from '@tradejs/types';

export type TradeParityExitType =
  | 'exit'
  | 'tp'
  | 'sl'
  | 'mixed'
  | 'open'
  | 'unknown';

export interface TradeParityEntry {
  id: string;
  source: 'runtime' | 'backtest';
  strategy: string;
  symbol: string;
  direction: Direction;
  qty?: number | null;
  timestamp: number;
  price: number | null;
  orderId?: string;
  signalId?: string;
  exitType?: TradeParityExitType | null;
  exitTimestamp?: number | null;
  exitPrice?: number | null;
  expectedPnl?: number | null;
  realizedPnl?: number | null;
  entryFee?: number | null;
  exitFee?: number | null;
  fundingFee?: number | null;
  totalFee?: number | null;
}

export interface MatchedTradeParityEntry {
  runtime: TradeParityEntry;
  backtest: TradeParityEntry;
  timestampDiffMs: number;
  priceDeltaPct: number | null;
}

export interface CompareTradeParityResult {
  matched: MatchedTradeParityEntry[];
  runtimeOnly: TradeParityEntry[];
  backtestOnly: TradeParityEntry[];
}

export interface RuntimeDuplicateGroup {
  key: string;
  strategy: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  entries: TradeParityEntry[];
}

export interface DedupeRuntimeParityEntriesResult {
  entries: TradeParityEntry[];
  duplicateGroups: RuntimeDuplicateGroup[];
  duplicateEntries: TradeParityEntry[];
}

const toFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toGroupKey = (
  entry: Pick<TradeParityEntry, 'strategy' | 'symbol' | 'direction'>,
) => `${entry.strategy}::${entry.symbol}::${entry.direction}`;

const toRuntimeDuplicateKey = (
  entry: Pick<
    TradeParityEntry,
    'strategy' | 'symbol' | 'direction' | 'timestamp'
  >,
) => `${toGroupKey(entry)}::${entry.timestamp}`;

const sortTradeParityEntries = (
  left: TradeParityEntry,
  right: TradeParityEntry,
) =>
  left.timestamp - right.timestamp ||
  left.strategy.localeCompare(right.strategy) ||
  left.symbol.localeCompare(right.symbol) ||
  left.direction.localeCompare(right.direction) ||
  left.id.localeCompare(right.id);

const buildPriceDeltaPct = (
  leftPrice: number | null,
  rightPrice: number | null,
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

const toExitType = (type: string | undefined): TradeParityExitType | null => {
  if (!type) return null;
  if (type === 'CLOSE_LONG' || type === 'CLOSE_SHORT') return 'exit';
  if (type === 'TAKE_PROFIT_LONG' || type === 'TAKE_PROFIT_SHORT') return 'tp';
  if (type === 'STOP_LOSS_LONG' || type === 'STOP_LOSS_SHORT') return 'sl';
  return null;
};

const resolveBacktestExitType = (
  values: Array<TradeParityExitType | null>,
): TradeParityExitType | null => {
  const unique = [...new Set(values.filter(Boolean))] as TradeParityExitType[];
  if (!unique.length) return 'open';
  return unique.length === 1 ? unique[0] : 'mixed';
};

export const extractBacktestEntryParityEntries = (
  orderLog: OrderLogData | null | undefined,
): TradeParityEntry[] => {
  if (!Array.isArray(orderLog)) {
    return [];
  }

  const entries: TradeParityEntry[] = [];
  for (let index = 0; index < orderLog.length; index += 1) {
    const item = orderLog[index];
    if (item.type !== 'OPEN_LONG' && item.type !== 'OPEN_SHORT') {
      continue;
    }
    if (
      !item.signal ||
      typeof item.signal.strategy !== 'string' ||
      typeof item.signal.symbol !== 'string' ||
      (item.signal.direction !== 'LONG' && item.signal.direction !== 'SHORT')
    ) {
      continue;
    }

    const signal = item.signal!;
    const timestamp =
      typeof signal.timestamp === 'number' && Number.isFinite(signal.timestamp)
        ? signal.timestamp
        : item.timestamp;

    const exitItems = [];
    for (const candidate of orderLog.slice(index + 1)) {
      if (candidate.symbol !== item.symbol) {
        continue;
      }
      if (candidate.type === 'OPEN_LONG' || candidate.type === 'OPEN_SHORT') {
        break;
      }
      exitItems.push(candidate);
    }
    const closingExitItems = exitItems.filter((candidate) =>
      toExitType(candidate.type),
    );
    const finalExit = closingExitItems[closingExitItems.length - 1] ?? null;
    const entryFee = toFiniteNumberOrNull(item.fee);
    const exitFee = closingExitItems.reduce((sum, candidate) => {
      const fee = toFiniteNumberOrNull(candidate.fee);
      return sum + (fee ?? 0);
    }, 0);
    const expectedPnl = [item, ...closingExitItems].reduce((sum, candidate) => {
      const profit = toFiniteNumberOrNull(candidate.profit);
      return sum + (profit ?? 0);
    }, 0);
    const totalFee = (entryFee ?? 0) + exitFee;

    entries.push({
      id:
        typeof signal.signalId === 'string' && signal.signalId.trim()
          ? signal.signalId
          : `backtest-${index}-${timestamp}`,
      source: 'backtest' as const,
      strategy: signal.strategy,
      symbol: signal.symbol,
      direction: signal.direction,
      qty: toFiniteNumberOrNull(item.qty),
      timestamp,
      price: toFiniteNumberOrNull(item.price),
      signalId:
        typeof signal.signalId === 'string' ? signal.signalId : undefined,
      exitType: resolveBacktestExitType(
        closingExitItems.map((candidate) => toExitType(candidate.type)),
      ),
      exitTimestamp: finalExit?.timestamp ?? null,
      exitPrice: toFiniteNumberOrNull(finalExit?.price),
      expectedPnl,
      entryFee,
      exitFee,
      fundingFee: 0,
      totalFee,
    });
  }

  return entries.sort((left, right) => left.timestamp - right.timestamp);
};

export const extractRuntimeParityEntries = (
  trades: RuntimeTradeRecord[],
): TradeParityEntry[] =>
  trades
    .filter(
      (trade) =>
        typeof trade.strategy === 'string' &&
        typeof trade.symbol === 'string' &&
        (trade.direction === 'LONG' || trade.direction === 'SHORT') &&
        typeof trade.entryTimestamp === 'number' &&
        Number.isFinite(trade.entryTimestamp),
    )
    .map((trade) => ({
      id: trade.orderId,
      source: 'runtime' as const,
      strategy: trade.strategy,
      symbol: trade.symbol,
      direction: trade.direction,
      qty: toFiniteNumberOrNull(trade.qty),
      timestamp: trade.entryTimestamp,
      price: toFiniteNumberOrNull(trade.entryPrice),
      orderId: trade.orderId,
      signalId: typeof trade.signalId === 'string' ? trade.signalId : undefined,
      exitType: trade.exitType ?? null,
      exitTimestamp: trade.exitTimestamp ?? null,
      exitPrice: trade.exitPrice ?? null,
      realizedPnl: trade.closedPnl ?? trade.currentPnl ?? null,
      entryFee: trade.openFee ?? null,
      exitFee: trade.closeFee ?? null,
      fundingFee: trade.fundingFee ?? null,
      totalFee: trade.totalFee ?? null,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);

export const findRuntimeDuplicateGroups = (
  entries: TradeParityEntry[],
): RuntimeDuplicateGroup[] => {
  const groups = new Map<string, TradeParityEntry[]>();

  for (const entry of entries) {
    if (entry.source !== 'runtime') {
      continue;
    }

    const key = toRuntimeDuplicateKey(entry);
    const bucket = groups.get(key) ?? [];
    bucket.push(entry);
    groups.set(key, bucket);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => {
      const sortedGroup = [...group].sort(sortTradeParityEntries);
      const first = sortedGroup[0];

      return {
        key,
        strategy: first.strategy,
        symbol: first.symbol,
        direction: first.direction,
        timestamp: first.timestamp,
        entries: sortedGroup,
      };
    })
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.strategy.localeCompare(right.strategy) ||
        left.symbol.localeCompare(right.symbol) ||
        left.direction.localeCompare(right.direction),
    );
};

export const dedupeRuntimeParityEntries = (
  entries: TradeParityEntry[],
): DedupeRuntimeParityEntriesResult => {
  const duplicateGroups = findRuntimeDuplicateGroups(entries);
  const duplicateEntriesSet = new Set<TradeParityEntry>();

  for (const group of duplicateGroups) {
    for (const duplicate of group.entries.slice(1)) {
      duplicateEntriesSet.add(duplicate);
    }
  }

  const dedupedEntries = entries
    .filter((entry) => !duplicateEntriesSet.has(entry))
    .sort(sortTradeParityEntries);
  const duplicateEntries = duplicateGroups
    .flatMap((group) => group.entries.slice(1))
    .sort(sortTradeParityEntries);

  return {
    entries: dedupedEntries,
    duplicateGroups,
    duplicateEntries,
  };
};

export const compareTradeParityEntries = ({
  runtimeEntries,
  backtestEntries,
  toleranceMs,
  backtestTimestampOffsetMs = 0,
}: {
  runtimeEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
  backtestTimestampOffsetMs?: number;
}): CompareTradeParityResult => {
  const matched: MatchedTradeParityEntry[] = [];
  const runtimeOnly: TradeParityEntry[] = [];
  const backtestOnly: TradeParityEntry[] = [];

  const groupedRuntime = new Map<string, TradeParityEntry[]>();
  const groupedBacktest = new Map<string, TradeParityEntry[]>();

  for (const entry of runtimeEntries) {
    const key = toGroupKey(entry);
    const bucket = groupedRuntime.get(key) ?? [];
    bucket.push(entry);
    groupedRuntime.set(key, bucket);
  }

  for (const entry of backtestEntries) {
    const key = toGroupKey(entry);
    const bucket = groupedBacktest.get(key) ?? [];
    bucket.push(entry);
    groupedBacktest.set(key, bucket);
  }

  const groupKeys = new Set([
    ...groupedRuntime.keys(),
    ...groupedBacktest.keys(),
  ]);

  for (const key of groupKeys) {
    const runtimeGroup = [...(groupedRuntime.get(key) ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
    const backtestGroup = [...(groupedBacktest.get(key) ?? [])].sort(
      (left, right) => left.timestamp - right.timestamp,
    );
    const unmatchedBacktest = backtestGroup.map((entry) => ({
      entry,
      used: false,
    }));

    for (const runtimeEntry of runtimeGroup) {
      let bestIndex = -1;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (let index = 0; index < unmatchedBacktest.length; index += 1) {
        const candidate = unmatchedBacktest[index];
        if (candidate.used) {
          continue;
        }

        const diff = Math.abs(
          candidate.entry.timestamp +
            backtestTimestampOffsetMs -
            runtimeEntry.timestamp,
        );
        if (diff > toleranceMs || diff >= bestDiff) {
          continue;
        }

        bestIndex = index;
        bestDiff = diff;
      }

      if (bestIndex < 0) {
        runtimeOnly.push(runtimeEntry);
        continue;
      }

      unmatchedBacktest[bestIndex].used = true;
      const backtestEntry = unmatchedBacktest[bestIndex].entry;
      matched.push({
        runtime: runtimeEntry,
        backtest: backtestEntry,
        timestampDiffMs: bestDiff,
        priceDeltaPct: buildPriceDeltaPct(
          runtimeEntry.price,
          backtestEntry.price,
        ),
      });
    }

    for (const candidate of unmatchedBacktest) {
      if (!candidate.used) {
        backtestOnly.push(candidate.entry);
      }
    }
  }

  matched.sort(
    (left, right) => left.runtime.timestamp - right.runtime.timestamp,
  );
  runtimeOnly.sort((left, right) => left.timestamp - right.timestamp);
  backtestOnly.sort((left, right) => left.timestamp - right.timestamp);

  return {
    matched,
    runtimeOnly,
    backtestOnly,
  };
};

export const summarizeMatchedParity = (
  matched: MatchedTradeParityEntry[],
): {
  avgPriceDeltaPct: number | null;
  maxPriceDeltaPct: number | null;
  avgTimestampDiffMs: number | null;
  maxTimestampDiffMs: number | null;
} => {
  if (!matched.length) {
    return {
      avgPriceDeltaPct: null,
      maxPriceDeltaPct: null,
      avgTimestampDiffMs: null,
      maxTimestampDiffMs: null,
    };
  }

  const priceDeltas = matched
    .map((item) => item.priceDeltaPct)
    .filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
  const timestampDiffs = matched
    .map((item) => item.timestampDiffMs)
    .filter((value): value is number => Number.isFinite(value));

  const average = (values: number[]) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const maximum = (values: number[]) =>
    values.length ? Math.max(...values) : null;

  return {
    avgPriceDeltaPct: average(priceDeltas),
    maxPriceDeltaPct: maximum(priceDeltas),
    avgTimestampDiffMs: average(timestampDiffs),
    maxTimestampDiffMs: maximum(timestampDiffs),
  };
};
