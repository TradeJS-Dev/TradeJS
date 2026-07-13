import type { MarketUniverse } from '@tradejs/types';

export const buildDashboardUrl = ({
  baseUrl,
  provider = 'bybit',
  universe = 'crypto',
  symbol,
  interval,
  searchParams = {},
}: {
  baseUrl: string;
  provider?: string;
  universe?: MarketUniverse;
  symbol: string;
  interval: string;
  searchParams?: Record<string, string>;
}) => {
  const url = new URL(
    `/routes/dashboard/${provider}/${universe}/${symbol}/${interval}`,
    baseUrl,
  );

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
};
