import { atom } from 'recoil';
import { getTimestamp } from '@utils/timestamp';
import { Interval, Filters } from '@types';

export const filtersState = atom<Filters>({
  key: 'Filters',
  default: {
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getTimestamp(60),
    end: getTimestamp(),
  },
});
