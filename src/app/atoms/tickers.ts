import { atom, selector } from 'recoil';
import _ from 'lodash';
import { Items } from '@types';

const base = [
  { label: 'BTC', value: 'BTCUSDT' },
  { label: 'ETH', value: 'ETHUSDT' },
] as Items;

const favorites = [
  { label: 'SOL', value: 'SOLUSDT', description: 'favorites' },
  { label: 'SUI', value: 'SUIUSDT', description: 'favorites' },
  { label: 'DOGS', value: 'DOGSUSDT', description: 'favorites' },
] as Items;

export const tickersState = atom({
  key: 'Tickers',
  default: {
    base,
    favorites,
    scanner: [] as Items,
  },
});

export const tickersListSelector = selector({
  key: 'TickersList',
  get: ({ get }) => {
    const { base, favorites, scanner } = get(tickersState);
    return _.uniqBy([...base, ...favorites, ...scanner], (item) => item.value);
  },
});
