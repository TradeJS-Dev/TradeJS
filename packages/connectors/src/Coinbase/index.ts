'use server';

import { fetchWithRetry } from '@tradejs/infra/http';
import {
  ConnectorCreator,
  Interval,
  KlineChartData,
  Ticker,
} from '@tradejs/types';

const INTERVAL_MS: Record<string, number> = {
  '1': 60_000,
  '3': 180_000,
  '5': 300_000,
  '15': 900_000,
  '30': 1_800_000,
  '60': 3_600_000,
  '120': 7_200_000,
  '240': 14_400_000,
  '360': 21_600_000,
  '720': 43_200_000,
  D: 86_400_000,
  W: 604_800_000,
  M: 2_592_000_000,
};

const GRANULARITY_MAP: Record<string, number> = {
  '1': 60,
  '3': 300,
  '5': 300,
  '15': 900,
  '30': 1800,
  '60': 3600,
  '120': 21600,
  '240': 21600,
  '360': 21600,
  '720': 21600,
  D: 86400,
  W: 86400,
  M: 86400,
};

const toNum = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toCoinbaseProduct = (symbol: string) => {
  const upper = symbol.toUpperCase();
  const quoteSuffixes = ['USDT', 'USDC', 'BUSD', 'USD'];
  for (const quote of quoteSuffixes) {
    if (upper.endsWith(quote)) {
      const base = upper.slice(0, -quote.length);
      if (!base) return null;
      return `${base}-USD`;
    }
  }
  return null;
};

const MAJOR_PRODUCTS = [
  'BTC-USD',
  'ETH-USD',
  'SOL-USD',
  'XRP-USD',
  'ADA-USD',
  'DOGE-USD',
  'LTC-USD',
  'BCH-USD',
  'LINK-USD',
  'AVAX-USD',
];

export const CoinbaseConnectorCreator: ConnectorCreator = async () => {
  let state: Record<string, unknown> = {};

  return {
    getState: async () => state,
    setState: async (newState) => {
      state = { ...state, ...newState };
    },

    kline: async ({ symbol, interval, start, end }) => {
      const granularity = GRANULARITY_MAP[String(interval)];
      if (!granularity) return [];

      const product = toCoinbaseProduct(symbol);
      if (!product) return [];

      const baseUrl =
        process.env.COINBASE_BASE_URL?.trim() ||
        'https://api.exchange.coinbase.com';

      const stepMs = granularity * 1000 * 300;
      const fromMs =
        start ?? Math.max(0, end - INTERVAL_MS[String(interval)] * 1000);
      let cursorEnd = end;
      const rows: KlineChartData = [];

      while (cursorEnd >= fromMs) {
        const chunkStart = Math.max(fromMs, cursorEnd - stepMs);
        const url = new URL(`${baseUrl}/products/${product}/candles`);
        url.searchParams.set('granularity', String(granularity));
        url.searchParams.set('start', new Date(chunkStart).toISOString());
        url.searchParams.set('end', new Date(cursorEnd).toISOString());

        const response = await fetchWithRetry(url.toString(), {
          headers: { 'User-Agent': 'tradejs/coinbase-connector' },
        });
        if (!response.ok) break;
        const payload = (await response.json()) as unknown[];
        if (Array.isArray(payload)) {
          for (const item of payload) {
            if (!Array.isArray(item)) continue;
            const ts = toNum(item[0]) * 1000;
            rows.push({
              timestamp: ts,
              low: toNum(item[1]),
              high: toNum(item[2]),
              open: toNum(item[3]),
              close: toNum(item[4]),
              volume: toNum(item[5]),
              turnover: 0,
              dt: new Date(ts).toISOString(),
            });
          }
        }
        cursorEnd = chunkStart - 1;
      }

      const dedup = new Map<number, KlineChartData[number]>();
      for (const row of rows) {
        dedup.set(row.timestamp, row);
      }
      return [...dedup.values()].sort((a, b) => a.timestamp - b.timestamp);
    },

    getPosition: async () => null,
    getPositions: async () => [],
    placeOrder: async () => false,
    setTakeProfits: async () => false,
    setStopLoss: async () => false,
    closePosition: async () => false,

    getTickers: async () => {
      const baseUrl =
        process.env.COINBASE_BASE_URL?.trim() ||
        'https://api.exchange.coinbase.com';

      const entries = await Promise.all(
        MAJOR_PRODUCTS.map(async (product) => {
          const [tickerRes, statsRes] = await Promise.all([
            fetchWithRetry(`${baseUrl}/products/${product}/ticker`, {
              headers: { 'User-Agent': 'tradejs/coinbase-connector' },
            }),
            fetchWithRetry(`${baseUrl}/products/${product}/stats`, {
              headers: { 'User-Agent': 'tradejs/coinbase-connector' },
            }),
          ]);
          if (!tickerRes.ok || !statsRes.ok) return null;
          const ticker = (await tickerRes.json()) as Record<string, unknown>;
          const stats = (await statsRes.json()) as Record<string, unknown>;
          const base = product.replace('-USD', '');
          const symbol = `${base}USDT`;
          const open = toNum(stats.open);
          const last = toNum(ticker.price);
          const pct = open > 0 ? (last - open) / open : 0;
          return {
            symbol,
            lastPrice: last,
            indexPrice: last,
            markPrice: last,
            prevPrice24h: open,
            price24hPcnt: pct,
            highPrice24h: toNum(stats.high),
            lowPrice24h: toNum(stats.low),
            prevPrice1h: 0,
            openInterest: 0,
            openInterestValue: 0,
            turnover24h: 0,
            volume24h: toNum(stats.volume),
            fundingRate: 0,
            nextFundingTime: 0,
            predictedDeliveryPrice: '',
            basisRate: '',
            deliveryFeeRate: '',
            deliveryTime: 0,
            ask1Size: toNum(ticker.ask_size),
            bid1Price: toNum(ticker.bid),
            ask1Price: toNum(ticker.ask),
            bid1Size: toNum(ticker.bid_size),
            basis: '',
            preOpenPrice: '',
            preQty: '',
          } as Ticker;
        }),
      );

      return entries.filter((item): item is Ticker => item != null);
    },
  };
};
