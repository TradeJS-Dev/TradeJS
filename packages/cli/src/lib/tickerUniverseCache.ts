import { getTopTickers } from '@tradejs/core/tickers';
import { getData, redisKeys, setData } from '@tradejs/infra/redis';
import type { Connector, Ticker } from '@tradejs/types';
import { getTickers } from '@tradejs/node/cli';

const TICKER_CACHE_VERSION = 1;

type CachedTickerUniverse = {
  version: number;
  connectorName: string;
  updatedAt: string;
  tickers: Ticker[];
};

const parseSymbolsFromCLI = (symbols = '') =>
  symbols
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

const isTickerLike = (value: unknown): value is Ticker => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const ticker = value as Partial<Ticker>;
  return (
    typeof ticker.symbol === 'string' &&
    ticker.symbol.trim().length > 0 &&
    typeof ticker.volume24h === 'number' &&
    Number.isFinite(ticker.volume24h)
  );
};

const readCachedTickerUniverse = async (
  cacheKey: string,
): Promise<Ticker[] | null> => {
  const cached = (await getData(cacheKey, null)) as CachedTickerUniverse | null;
  if (!cached || !Array.isArray(cached.tickers)) {
    return null;
  }

  const tickers = cached.tickers.filter(isTickerLike);
  return tickers.length ? tickers : null;
};

const selectTickerSymbols = ({
  tickers,
  exclude,
  limit,
}: {
  tickers: Ticker[];
  exclude?: string;
  limit?: number;
}) => {
  const excludedTickers = parseSymbolsFromCLI(exclude);
  return getTopTickers(tickers, limit)
    .map(({ value }) => value)
    .filter((ticker) => !excludedTickers.includes(ticker));
};

export const loadRunTickers = async ({
  connector,
  connectorName,
  userName,
  include,
  exclude,
  limit,
  cacheOnly,
}: {
  connector: Connector;
  connectorName: string;
  userName: string;
  include?: string;
  exclude?: string;
  limit?: number;
  cacheOnly?: boolean;
}): Promise<string[]> => {
  if (include?.trim()) {
    return getTickers(connector, include, exclude, limit);
  }

  const cacheKey = redisKeys.tickerUniverse(userName, connectorName);

  if (cacheOnly) {
    const cachedTickers = await readCachedTickerUniverse(cacheKey);
    if (!cachedTickers) {
      throw new Error(
        `No cached ticker universe for ${connectorName}. Run once without --cacheOnly or pass --tickers explicitly.`,
      );
    }

    return selectTickerSymbols({
      tickers: cachedTickers,
      exclude,
      limit,
    });
  }

  const exchangeTickers = await connector.getTickers();
  if (exchangeTickers.length) {
    await setData(
      cacheKey,
      {
        version: TICKER_CACHE_VERSION,
        connectorName,
        updatedAt: new Date().toISOString(),
        tickers: exchangeTickers,
      } satisfies CachedTickerUniverse,
      { expire: 0 },
    );
  }

  return selectTickerSymbols({
    tickers: exchangeTickers,
    exclude,
    limit,
  });
};
