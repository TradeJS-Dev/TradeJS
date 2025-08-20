import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import _ from 'lodash';
import { useEffect } from 'react';
import { scan } from '@src/actions/scanner';
import { Items } from '@types';

const LOCAL_STORAGE_KEY = 'tickers';

interface TickersFavoritesState {
  favorites: Items;
  setFavorite: (ticker: string) => void;
}

const useFavoritesStore = create<TickersFavoritesState>()(
  persist(
    (set) => ({
      favorites: [
        { label: 'BTC', value: 'BTCUSDT', description: 'favorites' },
        { label: 'ETH', value: 'ETHUSDT', description: 'favorites' },
      ] as Items,
      setFavorite: (ticker: string) =>
        set(({ favorites }) => {
          if (favorites.some((favorite) => favorite.value === ticker)) {
            return {
              favorites: favorites.filter(
                (favorite) => favorite.value !== ticker,
              ),
            };
          }
          return {
            favorites: [
              ...favorites,
              {
                label: ticker.replace('USDT', ''),
                value: ticker,
                description: 'favorites',
              },
            ],
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

  const tickers = _.uniqBy([...favorites, ...scanner], (item) => item.value);

  return {
    tickers,
    favorites: favorites.map(({ value }) => value),
    setFavorite,
    setTickers,
  };
};
