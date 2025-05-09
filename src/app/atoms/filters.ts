import { atom } from 'recoil';
import { getTimestamp } from '@utils/timestamp';
import { Interval, Filters } from '@types';

export const filtersState = atom({
  key: 'Filters',
  default: {
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getTimestamp(30),
    end: getTimestamp(),
  } as Filters,
});
