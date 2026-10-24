import type {
  Connector,
  Interval,
  KlineChartItem,
  StrategyClosedCandlesRequest,
  StrategyClosedCandlesSnapshot,
  StrategyDecisionPriceContext,
} from '@tradejs/types';

const SOURCE_MS = 15 * 60_000;
const MAX_ROWS = 1536;

/** Bound symbol/venue through the runtime connector; callers cannot change them. */
export const createClosedCandlesReader =
  ({
    connector,
    symbol,
    interval,
    env,
    getDecisionPriceContext,
  }: {
    connector: Connector;
    symbol: string;
    interval: Interval;
    env: string;
    getDecisionPriceContext: () => StrategyDecisionPriceContext;
  }) =>
  async (
    request: StrategyClosedCandlesRequest,
  ): Promise<StrategyClosedCandlesSnapshot> => {
    const executionMinutes = Number(interval);
    if (!Number.isInteger(executionMinutes) || executionMinutes <= 0) {
      throw new Error(
        'getClosedCandles requires a fixed minute execution interval',
      );
    }
    const { candle } = getDecisionPriceContext();
    // Freeze before awaiting IO: another bar must not move the causal boundary.
    const asOf = candle.timestamp + executionMinutes * 60_000;
    const { start, end, limit } = request;
    if (
      request.interval !== '15' ||
      !Number.isSafeInteger(asOf) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start % SOURCE_MS !== 0 ||
      end % SOURCE_MS !== 0 ||
      end <= start ||
      end > asOf ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_ROWS ||
      (end - start) / SOURCE_MS > limit
    ) {
      throw new Error(
        'Invalid or non-causal getClosedCandles window (maximum 1536 slots)',
      );
    }
    const rows = await connector.kline({
      symbol,
      interval: '15',
      start,
      // Connector end is inclusive; the public window is half-open.
      end: end - 1,
      cacheOnly: env === 'BACKTEST' || env === 'PARITY',
      silent: true,
    });
    const byTimestamp = new Map<number, KlineChartItem>();
    for (const row of rows) {
      const timestamp = row.timestamp;
      // Do not inspect OHLCV from outside the causal requested window.
      if (timestamp < start || timestamp >= end || timestamp + SOURCE_MS > asOf)
        continue;
      if (
        !Number.isSafeInteger(timestamp) ||
        timestamp % SOURCE_MS !== 0 ||
        ![
          row.open,
          row.high,
          row.low,
          row.close,
          row.volume,
          row.turnover,
        ].every(Number.isFinite) ||
        row.high < row.low ||
        row.open < row.low ||
        row.open > row.high ||
        row.close < row.low ||
        row.close > row.high ||
        row.volume < 0 ||
        row.turnover < 0 ||
        byTimestamp.has(timestamp)
      ) {
        throw new Error('Invalid or duplicate getClosedCandles source row');
      }
      byTimestamp.set(timestamp, { ...row });
    }
    const candles: KlineChartItem[] = [];
    const missingRanges: StrategyClosedCandlesSnapshot['missingRanges'] = [];
    for (let timestamp = start; timestamp < end; timestamp += SOURCE_MS) {
      const row = byTimestamp.get(timestamp);
      if (row) candles.push(row);
      else {
        const last = missingRanges[missingRanges.length - 1];
        if (last?.end === timestamp) last.end += SOURCE_MS;
        else
          missingRanges.push({ start: timestamp, end: timestamp + SOURCE_MS });
      }
    }
    return {
      interval: '15',
      start,
      end,
      asOf,
      candles,
      complete: missingRanges.length === 0,
      missingRanges,
    };
  };
