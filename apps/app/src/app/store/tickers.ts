import { useEffect, useMemo, useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { get, set } from 'idb-keyval';
import _ from 'lodash';
import { scan } from '#actions/scanner';
import { MarketUniverse } from '@tradejs/types';
import type { Items } from '#app/types/ui';

const LOCAL_STORAGE_KEY = 'tickers';
const TICKERS_CACHE_TTL_MS = 10 * 60 * 1000;
const EMPTY_ITEMS: Items = [];

type TickersCacheRecord = {
  savedAt: number;
  items: Items;
};

interface FavoriteTickersState {
  favorites: string[];
  toggleFavorite: (ticker: string) => void;
}

const useFavoriteTickersStore = create<FavoriteTickersState>()(
  persist(
    (set) => ({
      favorites: ['BTCUSDT', 'ETHUSDT'],
      toggleFavorite: (ticker: string) =>
        set(({ favorites }) => {
          if (favorites.includes(ticker)) {
            return {
              favorites: favorites.filter((favorite) => favorite !== ticker),
            };
          }
          return {
            favorites: [...favorites, ticker],
          };
        }),
    }),
    {
      name: LOCAL_STORAGE_KEY,
    },
  ),
);

interface TickersScannerState {
  tickersByProvider: Record<string, Items>;
  loadedAtByProvider: Record<string, number>;
  inFlightByProvider: Record<string, Promise<Items> | undefined>;
  setTickers: (provider: string, tickers: Items, loadedAt?: number) => void;
  setInFlight: (provider: string, request?: Promise<Items>) => void;
}

const useScannerStore = create<TickersScannerState>((set) => ({
  tickersByProvider: {},
  loadedAtByProvider: {},
  inFlightByProvider: {},
  setTickers: (provider, coins, loadedAt = Date.now()) =>
    set((state) => ({
      tickersByProvider: {
        ...state.tickersByProvider,
        [provider]: _.sortBy(coins, 'label'),
      },
      loadedAtByProvider: {
        ...state.loadedAtByProvider,
        [provider]: loadedAt,
      },
      inFlightByProvider: {
        ...state.inFlightByProvider,
        [provider]: undefined,
      },
    })),
  setInFlight: (provider, request) =>
    set((state) => ({
      inFlightByProvider: {
        ...state.inFlightByProvider,
        [provider]: request,
      },
    })),
}));

const getProviderUniverseKey = (provider: string, universe: MarketUniverse) =>
  universe === 'crypto' ? provider : `${provider}:${universe}`;
const getTickersCacheKey = (providerUniverseKey: string) =>
  `tickers:${providerUniverseKey}`;

const isFresh = (savedAt: number) =>
  Date.now() - savedAt < TICKERS_CACHE_TTL_MS;

const reportTickerLoadError = (
  provider: string,
  universe: MarketUniverse,
  error: unknown,
) => {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(`Ticker loading failed for ${provider}:${universe}`, error);
  }
};

const loadTickersForProvider = async (
  provider: string,
  universe: MarketUniverse,
) => {
  const providerUniverseKey = getProviderUniverseKey(provider, universe);
  const {
    tickersByProvider,
    loadedAtByProvider,
    inFlightByProvider,
    setTickers,
    setInFlight,
  } = useScannerStore.getState();
  const memoryTickers = tickersByProvider[providerUniverseKey] ?? [];
  const loadedAt = loadedAtByProvider[providerUniverseKey] ?? 0;

  if (memoryTickers.length && isFresh(loadedAt)) {
    return memoryTickers;
  }

  const inFlight = inFlightByProvider[providerUniverseKey];
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const cached = (await get(
      getTickersCacheKey(providerUniverseKey),
    )) as TickersCacheRecord | null;

    if (cached?.items?.length && isFresh(cached.savedAt)) {
      setTickers(providerUniverseKey, cached.items, cached.savedAt);
      return cached.items;
    }

    let coins: Items;
    try {
      coins = await scan(provider, universe);
    } catch (error) {
      if (cached?.items?.length) {
        setTickers(providerUniverseKey, cached.items, cached.savedAt);
        return cached.items;
      }
      throw error;
    }
    const savedAt = Date.now();
    setTickers(providerUniverseKey, coins, savedAt);
    await set(getTickersCacheKey(providerUniverseKey), {
      savedAt,
      items: coins,
    } satisfies TickersCacheRecord);
    return coins;
  })()
    .catch((error) => {
      reportTickerLoadError(provider, universe, error);
      throw error;
    })
    .finally(() => {
      useScannerStore.getState().setInFlight(providerUniverseKey, undefined);
    });

  setInFlight(providerUniverseKey, pending);
  return pending;
};

export const useTickers = (
  provider = 'bybit',
  universeOrOptions: MarketUniverse | { enabled?: boolean } = 'crypto',
  options: { enabled?: boolean } = {},
) => {
  const universe =
    typeof universeOrOptions === 'string' ? universeOrOptions : 'crypto';
  const { enabled = true } =
    typeof universeOrOptions === 'string' ? options : universeOrOptions;
  const favorites = useFavoriteTickersStore((s) => s.favorites);
  const tickers = useScannerStore(
    (s) =>
      s.tickersByProvider[getProviderUniverseKey(provider, universe)] ??
      EMPTY_ITEMS,
  );
  const toggleFavorite = useFavoriteTickersStore((s) => s.toggleFavorite);
  const checkIsFavorite = useCallback(
    (ticker: string) => favorites.includes(ticker),
    [favorites],
  );
  const ensureLoaded = useCallback(
    () => loadTickersForProvider(provider, universe),
    [provider, universe],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void ensureLoaded().catch(() => undefined);
  }, [enabled, ensureLoaded]);

  const items = useMemo(() => {
    const favoriteItems = tickers
      .filter((s) => checkIsFavorite(s.value))
      .map((s) => ({
        ...s,
        description: `${s.description} ⭐️`,
      }));

    return _.uniqBy([...favoriteItems, ...tickers], (item) => item.value);
  }, [tickers, checkIsFavorite]);

  return {
    tickers: items,
    favorites,
    checkIsFavorite,
    toggleFavorite,
    ensureLoaded,
  };
};

export const resetTickersStoreForTests = () => {
  useScannerStore.setState({
    tickersByProvider: {},
    loadedAtByProvider: {},
    inFlightByProvider: {},
  });
};
