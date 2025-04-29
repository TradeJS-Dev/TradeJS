import { atom } from 'recoil';
import { getUnixTime, subDays } from 'date-fns';
import { Interval, Filters } from '@types';

export const filtersState = atom({
  key: 'Filters',
  default: {
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getUnixTime(subDays(new Date(), 30)) * 1000,
    end: getUnixTime(new Date()) * 1000,
  } as Filters,
});
