import { atom } from 'recoil';
import { KlineIntervalV3 } from 'bybit-api';
import { getUnixTime, subDays } from 'date-fns';
import { Filters } from '@types';

export const filtersState = atom({
  key: 'Filters',
  default: {
    symbol: 'BTCUSDT',
    interval: '15' as KlineIntervalV3,
    start: getUnixTime(subDays(new Date(), 30)) * 1000,
    end: getUnixTime(new Date()) * 1000,
  } as Filters,
});
