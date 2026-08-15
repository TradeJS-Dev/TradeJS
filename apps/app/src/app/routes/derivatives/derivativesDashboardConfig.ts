import { buildKlinePath } from '#app/lib/marketRoutes';
import type { DerivativesInterval } from './derivativesViewModel';

export type ChartWindow = {
  startTimestamp: number;
  endTimestamp: number;
};

export const HOURS_OPTIONS = [
  { label: 'Last 24h', value: '24' },
  { label: 'Last 7d', value: '168' },
  { label: 'Last 30d', value: '720' },
  { label: 'Last 60d', value: '1440' },
  { label: 'Last 90d', value: '2160' },
];

export const INTERVAL_OPTIONS = ['15m', '1h'] as const;
export const FIXED_SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;

const DERIVATIVES_TO_KLINE_INTERVAL = {
  '15m': '15',
  '1h': '60',
} as const;

export const buildDerivativesDashboardRequest = ({
  hours,
  selectedInterval,
  now = Date.now(),
}: {
  hours: string;
  selectedInterval: DerivativesInterval;
  now?: number;
}) => {
  const from = now - Number(hours) * 60 * 60 * 1000;
  const symbols = FIXED_SYMBOLS.join(',');
  const klineInterval = DERIVATIVES_TO_KLINE_INTERVAL[selectedInterval];

  return {
    summaryPath: `/api/derivatives/summary?hours=${hours}&limit=200&symbols=${symbols}`,
    chartWindow: { startTimestamp: from, endTimestamp: now },
    details: FIXED_SYMBOLS.map((symbol) => ({
      symbol,
      derivativesPath: `/api/derivatives/${symbol}/${selectedInterval}?from=${from}&to=${now}`,
      pricePath: buildKlinePath({
        provider: 'bybit',
        universe: 'crypto',
        symbol,
        interval: klineInterval,
      }),
      priceBody: { start: from, end: now },
    })),
  };
};
