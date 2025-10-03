import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { useEffect } from 'react';
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
  scanner: Items;
  setTickers: (tickers: Items) => void;
}

const useScannerStore = create<TickersScannerState>((set) => ({
  scanner: [] as Items,
  setTickers: (coins) => set(() => ({ scanner: _.sortBy(coins, 'label') })),
}));

export const useTickers = () => {
  const favorites = useFavoriteTickersStore((s) => s.favorites);
  const scanner = useScannerStore((s) => s.scanner);
  const toggleFavorite = useFavoriteTickersStore((s) => s.toggleFavorite);
  const setTickers = useScannerStore((s) => s.setTickers);
  const checkIsFavorite = (ticker: string) => favorites.includes(ticker);

  useEffect(() => {
    if (scanner.length) {
      return;
    }

    scan().then((coins) => {
      setTickers(coins);
    });
  }, []);

  const favoriteItems = scanner
    .filter((s) => checkIsFavorite(s.value))
    .map((s) => ({
      ...s,
      description: 'favorite',
    }));

  const tickers = _.uniqBy(
    [...favoriteItems, ...scanner],
    (item) => item.value,
  );

  return {
    tickers,
    favorites,
    checkIsFavorite,
    toggleFavorite,
    setTickers,
  };
};
