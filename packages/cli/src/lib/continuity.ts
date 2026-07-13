import {
  KlineChartData,
  MarketUniverse,
  isMarketUniverse,
} from '@tradejs/types';

export type ContinuityUniverse = MarketUniverse | 'all';

export const parseContinuityUniverse = (value: unknown): ContinuityUniverse => {
  const normalized = String(value ?? 'all')
    .trim()
    .toLowerCase();

  if (normalized === 'all' || isMarketUniverse(normalized)) {
    return normalized;
  }

  throw new Error(
    `Unknown market universe: ${normalized}. Supported: all, crypto, tradfi`,
  );
};

export const resolveContinuityUniverses = (
  requested: ContinuityUniverse,
  supported: readonly MarketUniverse[],
): MarketUniverse[] =>
  requested === 'all'
    ? [...supported]
    : supported.includes(requested)
      ? [requested]
      : [];

export const findRepairableContinuityGap = (
  data: KlineChartData,
  expectedMs: number,
  universe: MarketUniverse,
) => {
  // TradFi candles legitimately stop between market sessions. Bybit does not
  // expose a trading calendar with kline/instrument responses, so a timestamp
  // gap alone is not enough evidence to delete and rebuild this cache.
  if (universe === 'tradfi') return null;

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const current = data[i];
    const diff = current.timestamp - prev.timestamp;

    if (diff !== expectedMs) {
      return {
        prevTs: prev.timestamp,
        ts: current.timestamp,
        diffSeconds: Math.floor(diff / 1000),
      };
    }
  }

  return null;
};
