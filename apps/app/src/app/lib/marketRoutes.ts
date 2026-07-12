import {
  Interval,
  isMarketUniverse,
  MarketUniverse,
  Provider,
} from '@tradejs/types';

const UNIVERSE_ROUTE_SEGMENT = 'universe';

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
  `/api/kline/${provider}/${UNIVERSE_ROUTE_SEGMENT}/${universe}/${symbol}/${interval}`;

export const buildDashboardPath = ({
  provider,
  universe,
  symbol,
  interval,
}: MarketRouteParts) =>
  `/routes/dashboard/${provider}/${UNIVERSE_ROUTE_SEGMENT}/${universe}/${symbol}/${interval}`;

export const parseDashboardPath = (
  pathname: string,
  fallback: DashboardRouteParts,
): DashboardRouteParts => {
  const parts = pathname.split('/').filter(Boolean);
  const hasExplicitUniverse = parts[3] === UNIVERSE_ROUTE_SEGMENT;
  const rawUniverse = hasExplicitUniverse ? parts[4] : 'crypto';

  return {
    provider: (parts[2] || fallback.provider) as Provider,
    universe: isMarketUniverse(rawUniverse) ? rawUniverse : fallback.universe,
    symbol: parts[hasExplicitUniverse ? 5 : 3] || fallback.symbol,
    interval: (parts[hasExplicitUniverse ? 6 : 4] ||
      fallback.interval) as Interval,
  };
};
