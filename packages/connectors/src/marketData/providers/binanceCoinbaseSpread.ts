import { DerivativesInterval } from '@utils/timescale';
import {
  alignSpreadRows,
  coinbaseProductFromSymbol,
  intervalToMs,
  PricePoint,
} from '@utils/marketSpread';
import { MarketDataProvider } from './types';
import { spotKlineProviders } from '@tradejs/connectors/marketData/spotKlineProviders';

const fetchBinanceKlines = async (params: {
  symbol: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}): Promise<PricePoint[]> => {
  const { symbol, interval, fromMs, toMs } = params;
  const rows = await spotKlineProviders.binance.kline({
    symbol,
    interval,
    start: fromMs,
    end: toMs,
  });
  return rows.map((row) => ({ ts: row.timestamp, close: row.close }));
};

const fetchCoinbaseCandles = async (params: {
  symbol: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}): Promise<PricePoint[]> => {
  const { symbol, interval, fromMs, toMs } = params;
  const product = coinbaseProductFromSymbol(symbol);
  if (!product) return [];

  const stepMs = intervalToMs(interval) * 250;

  const rows: PricePoint[] = [];
  let cursor = fromMs;
  while (cursor <= toMs) {
    const endMs = Math.min(toMs, cursor + stepMs);
    const klineRows = await spotKlineProviders.coinbase.kline({
      symbol: product,
      interval,
      start: cursor,
      end: endMs,
    });
    for (const row of klineRows) {
      rows.push({ ts: row.timestamp, close: row.close });
    }
    cursor = endMs + 1;
  }

  rows.sort((a, b) => a.ts - b.ts);
  const dedup = new Map<number, PricePoint>();
  for (const row of rows) dedup.set(row.ts, row);
  return [...dedup.values()].sort((a, b) => a.ts - b.ts);
};

export const binanceCoinbaseSpreadProvider: MarketDataProvider = {
  name: 'binance_coinbase_spread',
  fetchWindow: async ({ symbol, interval, fromMs, toMs }) => {
    const [binance, coinbase] = await Promise.all([
      fetchBinanceKlines({ symbol, interval, fromMs, toMs }),
      fetchCoinbaseCandles({ symbol, interval, fromMs, toMs }),
    ]);
    const spreadRows = alignSpreadRows({
      symbol,
      interval,
      binance,
      coinbase,
      source: 'binance_coinbase_spread',
    });
    return { spreadRows };
  },
};
