import {
  Interval,
  isMarketUniverse,
  MarketUniverse,
  Provider,
} from '@tradejs/types';

interface MarketRouteParts {
  provider: string;
  universe: MarketUniverse;
  symbol: string;
  interval: string;
}

interface DashboardRouteParts {
  provider: Provider;
  universe: MarketUniverse;
  symbol: string;
  interval: Interval;
}

const appendRouteQuery = (
  pathname: string,
  universe: MarketUniverse,
  searchParams?: URLSearchParams,
) => {
  const params = new URLSearchParams(searchParams);

  if (universe === 'crypto') {
    params.delete('universe');
  } else {
    params.set('universe', universe);
  }

  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ''}`;
};

export const buildKlinePath = ({
  provider,
  universe,
  symbol,
  interval,
}: MarketRouteParts) =>
  appendRouteQuery(`/api/kline/${provider}/${symbol}/${interval}`, universe);

export const buildDashboardPath = (
  { provider, universe, symbol, interval }: MarketRouteParts,
  searchParams?: URLSearchParams,
) =>
  appendRouteQuery(
    `/routes/dashboard/${provider}/${symbol}/${interval}`,
    universe,
    searchParams,
  );

export const parseDashboardPath = (
  pathname: string,
  searchParams: URLSearchParams,
  fallback: Omit<DashboardRouteParts, 'universe'>,
): DashboardRouteParts => {
  const parts = pathname.split('/').filter(Boolean);
  const rawUniverse = searchParams.get('universe');

  return {
    provider: (parts[2] || fallback.provider) as Provider,
    universe: isMarketUniverse(rawUniverse) ? rawUniverse : 'crypto',
    symbol: parts[3] || fallback.symbol,
    interval: (parts[4] || fallback.interval) as Interval,
  };
};
