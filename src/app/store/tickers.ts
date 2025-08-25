import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { useEffect } from 'react';
import { scan } from '@src/actions/scanner';
import { Items } from '@types';

const LOCAL_STORAGE_KEY = 'tickers';

interface TickersFavoritesState {
  favorites: string[];
  setFavorite: (ticker: string) => void;
}

const useFavoritesStore = create<TickersFavoritesState>()(
  persist(
    (set) => ({
      favorites: ['BTCUSDT', 'ETHUSDT'],
      setFavorite: (ticker: string) =>
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
  const favorites = useFavoritesStore((s) => s.favorites);
  const scanner = useScannerStore((s) => s.scanner);
  const setFavorite = useFavoritesStore((s) => s.setFavorite);
  const setTickers = useScannerStore((s) => s.setTickers);

  useEffect(() => {
    if (scanner.length) {
      return;
    }

    scan().then((coins) => {
      setTickers(coins);
    });
  }, []);

  const checkIsFavorite = (ticker: string) => favorites.includes(ticker);

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
    setFavorite,
    setTickers,
  };
};
