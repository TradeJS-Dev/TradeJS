import { useEffect, useMemo, useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { scan } from '@actions/scanner';
import { Items } from '@types';

const LOCAL_STORAGE_KEY = 'tickers';

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
  tickers: Items;
  setTickers: (tickers: Items) => void;
}

const useScannerStore = create<TickersScannerState>((set) => ({
  tickers: [] as Items,
  setTickers: (coins) => set(() => ({ tickers: _.sortBy(coins, 'label') })),
}));

export const useTickers = () => {
  const favorites = useFavoriteTickersStore((s) => s.favorites);
  const tickers = useScannerStore((s) => s.tickers);
  const toggleFavorite = useFavoriteTickersStore((s) => s.toggleFavorite);
  const setTickers = useScannerStore((s) => s.setTickers);
  const checkIsFavorite = useCallback(
    (ticker: string) => favorites.includes(ticker),
    [favorites],
  );

  useEffect(() => {
    if (tickers.length) {
      return;
    }

    scan().then((coins) => {
      setTickers(coins);
    });
  }, []);

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
    setTickers,
  };
};
