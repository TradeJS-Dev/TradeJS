import { DerivativesInterval, SpreadRow } from './timescale';
import { toFiniteNumber } from './derivativesFeatureUtils';

export type PricePoint = {
  ts: number;
  close: number;
};

export const intervalToMs = (interval: DerivativesInterval) =>
  interval === '1h' ? 60 * 60 * 1000 : 15 * 60 * 1000;

export const coinbaseProductFromSymbol = (symbol: string) => {
  const upper = symbol.trim().toUpperCase();
  const quoteSuffixes = ['USDT', 'USDC', 'BUSD', 'USD'];
  for (const suffix of quoteSuffixes) {
    if (upper.endsWith(suffix)) {
      const base = upper.slice(0, -suffix.length);
      if (!base) return null;
      return `${base}-USD`;
    }
  }
  return null;
};

export const alignSpreadRows = (params: {
  symbol: string;
  interval: DerivativesInterval;
  binance: PricePoint[];
  coinbase: PricePoint[];
  source: string;
}): SpreadRow[] => {
  const { symbol, interval, binance, coinbase, source } = params;
  if (!binance.length || !coinbase.length) return [];

  const coinbaseByTs = new Map<number, number>();
  for (const row of coinbase) {
    if (!Number.isFinite(row.ts) || !Number.isFinite(row.close)) continue;
    coinbaseByTs.set(row.ts, row.close);
  }

  const rows: SpreadRow[] = [];
  for (const row of binance) {
    if (!Number.isFinite(row.ts) || !Number.isFinite(row.close) || row.close <= 0) {
      continue;
    }
    const cb = coinbaseByTs.get(row.ts);
    if (cb == null || !Number.isFinite(cb)) continue;
    const spread = (cb - row.close) / row.close;
    rows.push({
      symbol,
      interval,
      ts: new Date(row.ts),
      binancePrice: row.close,
      coinbasePrice: cb,
      spread,
      source,
    });
  }
  return rows;
};

export const rollingMeanStd = (
  values: number[],
  endIndex: number,
  window: number,
) => {
  const start = Math.max(0, endIndex - window + 1);
  const slice = values
    .slice(start, endIndex + 1)
    .map((x) => toFiniteNumber(x, Number.NaN))
    .filter((x) => Number.isFinite(x));
  if (!slice.length) return { mean: 0, std: 0 };
  const mean = slice.reduce((acc, x) => acc + x, 0) / slice.length;
  if (slice.length < 2) return { mean, std: 0 };
  const variance =
    slice.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / slice.length;
  return { mean, std: Math.sqrt(Math.max(variance, 0)) };
};
