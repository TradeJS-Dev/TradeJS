import { Direction, OrderLogData, RuntimeTradeRecord } from '@tradejs/types';

export interface TradeParityEntry {
  id: string;
  source: 'runtime' | 'backtest';
  strategy: string;
  symbol: string;
  direction: Direction;
  timestamp: number;
  price: number | null;
  orderId?: string;
  signalId?: string;
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

const toFiniteNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const toGroupKey = (
  entry: Pick<TradeParityEntry, 'strategy' | 'symbol' | 'direction'>,
) => `${entry.strategy}::${entry.symbol}::${entry.direction}`;

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

export const extractBacktestEntryParityEntries = (
  orderLog: OrderLogData | null | undefined,
): TradeParityEntry[] => {
  if (!Array.isArray(orderLog)) {
    return [];
  }

  return orderLog
    .filter(
      (item) =>
        (item.type === 'OPEN_LONG' || item.type === 'OPEN_SHORT') &&
        item.signal &&
        typeof item.signal.strategy === 'string' &&
        typeof item.signal.symbol === 'string' &&
        (item.signal.direction === 'LONG' || item.signal.direction === 'SHORT'),
    )
    .map((item, index) => {
      const signal = item.signal!;
      const timestamp =
        typeof signal.timestamp === 'number' &&
        Number.isFinite(signal.timestamp)
          ? signal.timestamp
          : item.timestamp;

      return {
        id:
          typeof signal.signalId === 'string' && signal.signalId.trim()
            ? signal.signalId
            : `backtest-${index}-${timestamp}`,
        source: 'backtest' as const,
        strategy: signal.strategy,
        symbol: signal.symbol,
        direction: signal.direction,
        timestamp,
        price: toFiniteNumberOrNull(item.price),
        signalId:
          typeof signal.signalId === 'string' ? signal.signalId : undefined,
      };
    })
    .sort((left, right) => left.timestamp - right.timestamp);
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
      timestamp: trade.entryTimestamp,
      price: toFiniteNumberOrNull(trade.entryPrice),
      orderId: trade.orderId,
      signalId: typeof trade.signalId === 'string' ? trade.signalId : undefined,
    }))
    .sort((left, right) => left.timestamp - right.timestamp);

export const compareTradeParityEntries = ({
  runtimeEntries,
  backtestEntries,
  toleranceMs,
}: {
  runtimeEntries: TradeParityEntry[];
  backtestEntries: TradeParityEntry[];
  toleranceMs: number;
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
          candidate.entry.timestamp - runtimeEntry.timestamp,
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
