import { DerivativesInterval } from '@utils/timescale';
import {
  coinalyzePointsToRows,
  mergeCoinalyzeMetrics,
} from '@utils/derivativesCoinalyze';
import { MarketDataProvider } from './types';

const fetchCoinalyzeSeries = async (params: {
  endpoint: string;
  symbol: string;
  interval: DerivativesInterval;
  fromMs: number;
  toMs: number;
}) => {
  const { endpoint, symbol, interval, fromMs, toMs } = params;
  const baseUrl =
    process.env.COINALYZE_BASE_URL?.trim() || 'https://api.coinalyze.net/v1';
  const apiKey = process.env.COINALYZE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing COINALYZE_API_KEY');
  }
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('from', String(Math.floor(fromMs / 1000)));
  url.searchParams.set('to', String(Math.floor(toMs / 1000)));

  const response = await fetch(url.toString(), {
    headers: {
      api_key: apiKey,
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Coinalyze ${endpoint} ${response.status}: ${text}`);
  }
  return response.json();
};

export const coinalyzeProvider: MarketDataProvider = {
  name: 'coinalyze',
  fetchWindow: async ({ symbol, interval, fromMs, toMs }) => {
    const oiPath =
      process.env.COINALYZE_OI_PATH?.trim() || '/open-interest-history';
    const fundingPath =
      process.env.COINALYZE_FUNDING_PATH?.trim() || '/funding-rate-history';
    const liqPath =
      process.env.COINALYZE_LIQ_PATH?.trim() || '/liquidation-history';

    const [oiRaw, fundingRaw, liqRaw] = await Promise.all([
      fetchCoinalyzeSeries({
        endpoint: oiPath,
        symbol,
        interval,
        fromMs,
        toMs,
      }),
      fetchCoinalyzeSeries({
        endpoint: fundingPath,
        symbol,
        interval,
        fromMs,
        toMs,
      }),
      fetchCoinalyzeSeries({
        endpoint: liqPath,
        symbol,
        interval,
        fromMs,
        toMs,
      }),
    ]);

    const points = mergeCoinalyzeMetrics({
      symbol,
      oiRaw,
      fundingRaw,
      liqRaw,
    });

    return {
      derivativesRows: coinalyzePointsToRows(points, interval, 'coinalyze'),
    };
  },
};
