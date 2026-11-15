import type { ReferenceMarketsContext } from '@tradejs/types';

export const REFERENCE_MARKET_BASKETS = {
  growth: [
    'AAPLUSDT',
    'MSFTUSDT',
    'NVDAUSDT',
    'TSLAUSDT',
    'AMZNUSDT',
    'GOOGLUSDT',
    'METAUSDT',
    'TSMUSDT',
  ],
  defensive: ['LLYUSDT', 'JNJUSDT', 'WMTUSDT'],
  cyclical: ['JPMUSDT', 'VUSDT', 'XOMUSDT', 'GEUSDT'],
} as const;

export const REFERENCE_TRADFI_SYMBOLS = [
  ...Object.values(REFERENCE_MARKET_BASKETS).flat(),
  'CLUSDT',
  'XAUUSDT',
  'XAGUSDT',
] as const;

export const REFERENCE_CRYPTO_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
] as const;

export const REFERENCE_MARKET_SYMBOLS = [
  ...REFERENCE_TRADFI_SYMBOLS,
  ...REFERENCE_CRYPTO_SYMBOLS,
] as const;

export const REFERENCE_MARKET_INTERVALS = { m15: 15, h1: 60, h4: 240 } as const;

export interface ReferenceMarketCandle {
  symbol: string;
  interval: number;
  timestamp: number;
  close: number;
  volume: number | null;
}

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

const nyDay = (timestamp: number) => {
  const parts = Object.fromEntries(
    nyClock.formatToParts(timestamp).map(({ type, value }) => [type, value]),
  );
  return {
    weekday: parts.weekday,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

const insideNyCashHours = (start: number, end: number) => {
  const first = nyDay(start);
  const last = nyDay(end - 1);
  return (
    first.weekday === last.weekday &&
    first.weekday !== 'Sat' &&
    first.weekday !== 'Sun' &&
    first.minute >= 570 &&
    last.minute < 960
  );
};

const difference = (a: number | null, b: number | null) =>
  a === null || b === null ? null : a - b;

/** Index once per storage window, compute each interval at most once per close. */
export const indexReferenceMarkets = (
  candles: readonly ReferenceMarketCandle[],
) => {
  const frames = Object.keys(REFERENCE_MARKET_INTERVALS) as Array<
    keyof typeof REFERENCE_MARKET_INTERVALS
  >;
  const bySeries = new Map<string, Map<number, ReferenceMarketCandle>>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.close) || candle.close <= 0) continue;
    const key = `${candle.symbol}:${candle.interval}`;
    let series = bySeries.get(key);
    if (!series) bySeries.set(key, (series = new Map()));
    series.set(candle.timestamp, candle);
  }

  const cached = new Map<string, ReferenceMarketsContext['frames']['h1']>();
  return (timestamp: number): ReferenceMarketsContext | undefined => {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) return;
    const context: ReferenceMarketsContext = {
      schema: 'tradejs-reference-markets/v1',
      provider: 'bybit',
      frames: {},
    };
    for (const frame of frames) {
      const interval = REFERENCE_MARKET_INTERVALS[frame];
      const step = interval * 60_000;
      const closedAt = Math.floor(timestamp / step) * step;
      const key = `${frame}:${closedAt}`;
      if (!cached.has(key)) {
        const returnsPct: Partial<Record<string, number>> = {};
        const traded = new Set<string>();
        for (const symbol of REFERENCE_MARKET_SYMBOLS) {
          const series = bySeries.get(`${symbol}:${interval}`);
          const last = series?.get(closedAt - step);
          const previous = series?.get(closedAt - 2 * step);
          if (!last || !previous) continue;
          returnsPct[symbol] =
            100 * (Math.log(last.close) - Math.log(previous.close));
          if ((last.volume ?? 0) > 0 && (previous.volume ?? 0) > 0)
            traded.add(symbol);
        }
        const mean = (symbols: readonly string[]) => {
          let total = 0;
          for (const symbol of symbols) {
            const value = returnsPct[symbol];
            if (value === undefined) return null;
            total += value;
          }
          return total / symbols.length;
        };
        const growthPct = mean(REFERENCE_MARKET_BASKETS.growth);
        const defensivePct = mean(REFERENCE_MARKET_BASKETS.defensive);
        cached.set(
          key,
          Object.keys(returnsPct).length
            ? Object.freeze({
                closedAt,
                returnsPct: Object.freeze(returnsPct),
                growthPct,
                defensivePct,
                cyclicalPct: mean(REFERENCE_MARKET_BASKETS.cyclical),
                growthMinusDefensivePct: difference(growthPct, defensivePct),
                goldMinusGrowthPct: difference(
                  returnsPct.XAUUSDT ?? null,
                  growthPct,
                ),
                nyCashHoursGrowthPct:
                  growthPct !== null &&
                  REFERENCE_MARKET_BASKETS.growth.every((symbol) =>
                    traded.has(symbol),
                  ) &&
                  insideNyCashHours(closedAt - step, closedAt)
                    ? growthPct
                    : null,
              })
            : undefined,
        );
      }
      const value = cached.get(key);
      if (value) context.frames[frame] = value;
    }
    return Object.keys(context.frames).length ? context : undefined;
  };
};
