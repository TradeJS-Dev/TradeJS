export type RecentCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export const takeRecentCandles = (
  candles: readonly RecentCandle[],
  limit: number,
): RecentCandle[] => candles.slice(-Math.max(0, limit));

export const appendRecentCandle = (
  candles: readonly RecentCandle[],
  candle: RecentCandle,
  limit: number,
): RecentCandle[] => {
  const boundedLimit = Math.max(0, limit);
  if (boundedLimit === 0) {
    return [];
  }

  return [
    ...candles.filter((item) => item.timestamp !== candle.timestamp),
    candle,
  ].slice(-boundedLimit);
};
