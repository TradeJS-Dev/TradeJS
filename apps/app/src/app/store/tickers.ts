import { useEffect, useMemo, useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { get, set } from 'idb-keyval';
import _ from 'lodash';
import { scan } from '#actions/scanner';
import { Items } from '@tradejs/types';

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

const getTickersCacheKey = (provider: string) => `tickers:${provider}`;

const isFresh = (savedAt: number) =>
  Date.now() - savedAt < TICKERS_CACHE_TTL_MS;

const loadTickersForProvider = async (provider: string) => {
  const {
    tickersByProvider,
    loadedAtByProvider,
    inFlightByProvider,
    setTickers,
    setInFlight,
  } = useScannerStore.getState();
  const memoryTickers = tickersByProvider[provider] ?? [];
  const loadedAt = loadedAtByProvider[provider] ?? 0;

  if (memoryTickers.length && isFresh(loadedAt)) {
    return memoryTickers;
  }

  const inFlight = inFlightByProvider[provider];
  if (inFlight) {
    return inFlight;
  }

  const pending = (async () => {
    const cached = (await get(
      getTickersCacheKey(provider),
    )) as TickersCacheRecord | null;

    if (cached?.items?.length && isFresh(cached.savedAt)) {
      setTickers(provider, cached.items, cached.savedAt);
      return cached.items;
    }

    const coins = await scan(provider);
    const savedAt = Date.now();
    setTickers(provider, coins, savedAt);
    await set(getTickersCacheKey(provider), {
      savedAt,
      items: coins,
    } satisfies TickersCacheRecord);
    return coins;
  })().finally(() => {
    useScannerStore.getState().setInFlight(provider, undefined);
  });

  setInFlight(provider, pending);
  return pending;
};

export const useTickers = (
  provider = 'bybit',
  options: { enabled?: boolean } = {},
) => {
  const { enabled = true } = options;
  const favorites = useFavoriteTickersStore((s) => s.favorites);
  const tickers = useScannerStore(
    (s) => s.tickersByProvider[provider] ?? EMPTY_ITEMS,
  );
  const toggleFavorite = useFavoriteTickersStore((s) => s.toggleFavorite);
  const checkIsFavorite = useCallback(
    (ticker: string) => favorites.includes(ticker),
    [favorites],
  );
  const ensureLoaded = useCallback(
    () => loadTickersForProvider(provider),
    [provider],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void ensureLoaded();
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
