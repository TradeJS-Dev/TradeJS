import { create } from 'zustand';
import _ from 'lodash';
import { useEffect } from 'react';
import { scan } from '@src/actions/scanner';
import { Items } from '@types';

const base = [
  { label: 'BTC', value: 'BTCUSDT' },
  { label: 'ETH', value: 'ETHUSDT' },
] as Items;

const favorites = [
  { label: 'SOL', value: 'SOLUSDT', description: 'favorites' },
  { label: 'SUI', value: 'SUIUSDT', description: 'favorites' },
  { label: 'DOGS', value: 'DOGSUSDT', description: 'favorites' },
  { label: 'DOGE', value: 'DOGEUSDT', description: 'favorites' },
] as Items;

interface TickersState {
  base: Items;
  favorites: Items;
  scanner: Items;
  setTickers: (tickers: Items) => void;
}

const useStore = create<TickersState>((set) => ({
  base,
  favorites,
  scanner: [] as Items,
  setTickers: (coins) => set(() => ({ scanner: coins })),
}));

export const useTickers = () => {
  const base = useStore((s) => s.base);
  const favorites = useStore((s) => s.favorites);
  const scanner = useStore((s) => s.scanner);
  const setTickers = useStore((s) => s.setTickers);

  useEffect(() => {
    if (scanner.length) {
      return;
    }

    scan().then((coins) => {
      setTickers(coins);
    });
  }, []);

  const tickers = _.uniqBy(
    [...base, ...favorites, ...scanner],
    (item) => item.value,
  );

  return {
    tickers,
    setTickers,
  };
};
