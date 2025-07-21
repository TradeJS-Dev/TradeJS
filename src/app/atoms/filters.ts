import { atom } from 'recoil';
import { DASHBOARD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { Interval, Filters } from '@types';

export const filtersState = atom<Filters>({
  key: 'Filters',
  default: {
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getTimestamp(DASHBOARD_DAYS),
    end: getTimestamp(),
  },
});
