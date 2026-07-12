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

export const buildKlinePath = ({
  provider,
  universe,
  symbol,
  interval,
}: MarketRouteParts) =>
  `/api/kline/${provider}/${universe}/${symbol}/${interval}`;

export const buildDashboardPath = ({
  provider,
  universe,
  symbol,
  interval,
}: MarketRouteParts) =>
  `/routes/dashboard/${provider}/${universe}/${symbol}/${interval}`;

export const parseDashboardPath = (
  pathname: string,
  fallback: Omit<DashboardRouteParts, 'universe'>,
): DashboardRouteParts => {
  const parts = pathname.split('/').filter(Boolean);
  const rawUniverse = parts[3];

  return {
    provider: (parts[2] || fallback.provider) as Provider,
    universe: isMarketUniverse(rawUniverse) ? rawUniverse : 'crypto',
    symbol: parts[4] || fallback.symbol,
    interval: (parts[5] || fallback.interval) as Interval,
  };
};
