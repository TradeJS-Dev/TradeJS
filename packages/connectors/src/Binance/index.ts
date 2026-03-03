'use server';

import { ConnectorCreator, Interval, KlineChartData, Ticker } from '@types';
import { fetchWithRetry } from '@utils/http';

const INTERVAL_MAP: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '120': '2h',
  '240': '4h',
  '360': '6h',
  '720': '12h',
  D: '1d',
  W: '1w',
  M: '1M',
};

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

const toNum = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const BinanceConnectorCreator: ConnectorCreator = async () => {
  let state: Record<string, unknown> = {};

  return {
    getState: async () => state,
    setState: async (newState) => {
      state = { ...state, ...newState };
    },

    kline: async ({ symbol, interval, start, end }) => {
      const intervalToken = INTERVAL_MAP[String(interval)];
      if (!intervalToken) return [];

      const intervalMs = INTERVAL_MS[String(interval)] ?? 900_000;
      const baseUrl =
        process.env.BINANCE_BASE_URL?.trim() || 'https://api.binance.com';

      let cursor = start ?? Math.max(0, end - intervalMs * 1000);
      const rows: KlineChartData = [];

      while (cursor <= end) {
        const url = new URL(`${baseUrl}/api/v3/klines`);
        url.searchParams.set('symbol', symbol);
        url.searchParams.set('interval', intervalToken);
        url.searchParams.set('startTime', String(cursor));
        url.searchParams.set('endTime', String(end));
        url.searchParams.set('limit', '1000');

        const response = await fetchWithRetry(url.toString(), {
          headers: { 'User-Agent': 'tradejs/binance-connector' },
        });
        if (!response.ok) break;
        const payload = (await response.json()) as unknown[];
        if (!Array.isArray(payload) || !payload.length) break;

        let lastTs = cursor;
        for (const item of payload) {
          if (!Array.isArray(item)) continue;
          const ts = toNum(item[0], 0);
          if (!ts) continue;
          rows.push({
            timestamp: ts,
            open: toNum(item[1]),
            high: toNum(item[2]),
            low: toNum(item[3]),
            close: toNum(item[4]),
            volume: toNum(item[5]),
            turnover: toNum(item[7]),
            dt: new Date(ts).toISOString(),
          });
          lastTs = ts;
        }
        if (payload.length < 1000) break;
        cursor = lastTs + intervalMs;
      }

      rows.sort((a, b) => a.timestamp - b.timestamp);
      return rows;
    },

    getPosition: async () => null,
    getPositions: async () => [],
    placeOrder: async () => false,
    closePosition: async () => false,

    getTickers: async () => {
      const baseUrl =
        process.env.BINANCE_BASE_URL?.trim() || 'https://api.binance.com';
      const response = await fetchWithRetry(`${baseUrl}/api/v3/ticker/24hr`, {
        headers: { 'User-Agent': 'tradejs/binance-connector' },
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(payload)) return [];

      return payload.map((row) => {
        const symbol = String(row.symbol ?? '');
        return {
          symbol,
          lastPrice: toNum(row.lastPrice),
          indexPrice: toNum(row.lastPrice),
          markPrice: toNum(row.lastPrice),
          prevPrice24h: toNum(row.openPrice),
          price24hPcnt: toNum(row.priceChangePercent) / 100,
          highPrice24h: toNum(row.highPrice),
          lowPrice24h: toNum(row.lowPrice),
          prevPrice1h: 0,
          openInterest: 0,
          openInterestValue: 0,
          turnover24h: toNum(row.quoteVolume),
          volume24h: toNum(row.volume),
          fundingRate: 0,
          nextFundingTime: 0,
          predictedDeliveryPrice: '',
          basisRate: '',
          deliveryFeeRate: '',
          deliveryTime: 0,
          ask1Size: toNum(row.askQty),
          bid1Price: toNum(row.bidPrice),
          ask1Price: toNum(row.askPrice),
          bid1Size: toNum(row.bidQty),
          basis: '',
          preOpenPrice: '',
          preQty: '',
        } as Ticker;
      });
    },
  };
};
