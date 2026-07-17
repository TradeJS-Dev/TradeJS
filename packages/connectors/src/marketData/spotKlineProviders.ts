import { KlineChartData, DerivativesInterval } from '@tradejs/types';
import { fetchWithRetry } from '@tradejs/infra/http';
import { getBinancePublicApiUrl } from '../shared/binancePublicApi';

export type SpotKlineRequest = {
  symbol: string;
  interval: DerivativesInterval;
  start: number;
  end: number;
};

export type SpotKlineProvider = {
  kline: (request: SpotKlineRequest) => Promise<KlineChartData>;
};

const toIntervalToken = (interval: DerivativesInterval) =>
  interval === '1h' ? '1h' : '15m';

export const mapBinanceKline = (payload: unknown[]): KlineChartData =>
  payload
    .map((item) => {
      if (!Array.isArray(item)) return null;
      const ts = Number(item[0]);
      const open = Number(item[1]);
      const high = Number(item[2]);
      const low = Number(item[3]);
      const close = Number(item[4]);
      const volume = Number(item[5]);
      const turnover = Number(item[7]) || 0;
      const takerBuyBaseVolume = Number(item[9]);
      const takerBuyQuoteVolume = Number(item[10]);
      if (![ts, open, high, low, close, volume].every(Number.isFinite))
        return null;
      const row: KlineChartData[number] = {
        timestamp: ts,
        open,
        high,
        low,
        close,
        volume,
        turnover,
        takerBuyBaseVolume: Number.isFinite(takerBuyBaseVolume)
          ? takerBuyBaseVolume
          : null,
        takerBuyQuoteVolume: Number.isFinite(takerBuyQuoteVolume)
          ? takerBuyQuoteVolume
          : null,
        takerSellBaseVolume: Number.isFinite(takerBuyBaseVolume)
          ? Math.max(0, volume - takerBuyBaseVolume)
          : null,
        takerSellQuoteVolume: Number.isFinite(takerBuyQuoteVolume)
          ? Math.max(0, turnover - takerBuyQuoteVolume)
          : null,
        dt: new Date(ts).toISOString(),
      };
      return row;
    })
    .filter((item): item is KlineChartData[number] => item != null)
    .sort((a, b) => a.timestamp - b.timestamp);

export const mapCoinbaseKline = (payload: unknown[]): KlineChartData =>
  payload
    .map((item) => {
      if (!Array.isArray(item)) return null;
      const tsSec = Number(item[0]);
      const low = Number(item[1]);
      const high = Number(item[2]);
      const open = Number(item[3]);
      const close = Number(item[4]);
      const volume = Number(item[5]);
      const ts = tsSec * 1000;
      if (![ts, open, high, low, close, volume].every(Number.isFinite))
        return null;
      return {
        timestamp: ts,
        open,
        high,
        low,
        close,
        volume,
        turnover: 0,
        dt: new Date(ts).toISOString(),
      };
    })
    .filter((item): item is KlineChartData[number] => item != null)
    .sort((a, b) => a.timestamp - b.timestamp);

export const spotKlineProviders: {
  binance: SpotKlineProvider;
  coinbase: SpotKlineProvider;
} = {
  binance: {
    kline: async ({ symbol, interval, start, end }) => {
      const token = toIntervalToken(interval);
      const baseUrl = getBinancePublicApiUrl();
      const url = new URL(`${baseUrl}/api/v3/klines`);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('interval', token);
      url.searchParams.set('startTime', String(start));
      url.searchParams.set('endTime', String(end));
      url.searchParams.set('limit', '1000');
      const response = await fetchWithRetry(url.toString(), {
        headers: { 'User-Agent': 'tradejs/market-data-ingest' },
      });
      if (!response.ok) {
        throw new Error(
          `Binance kline ${response.status}: ${await response.text()}`,
        );
      }
      const payload = (await response.json()) as unknown[];
      return Array.isArray(payload) ? mapBinanceKline(payload) : [];
    },
  },
  coinbase: {
    kline: async ({ symbol, interval, start, end }) => {
      const baseUrl =
        process.env.COINBASE_BASE_URL?.trim() ||
        'https://api.exchange.coinbase.com';
      const granularity = interval === '1h' ? 3600 : 900;
      const url = new URL(`${baseUrl}/products/${symbol}/candles`);
      url.searchParams.set('granularity', String(granularity));
      url.searchParams.set('start', new Date(start).toISOString());
      url.searchParams.set('end', new Date(end).toISOString());
      const response = await fetchWithRetry(url.toString(), {
        headers: {
          'User-Agent': 'tradejs/market-data-ingest',
          Accept: 'application/json',
        },
      });
      if (response.status === 404) return [];
      if (!response.ok) {
        throw new Error(
          `Coinbase kline ${response.status}: ${await response.text()}`,
        );
      }
      const payload = (await response.json()) as unknown[];
      return Array.isArray(payload) ? mapCoinbaseKline(payload) : [];
    },
  },
};
