import { atom } from 'recoil';
import { DASHBOARD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { Interval, UIFIlters } from '@types';

export const filtersState = atom<UIFIlters>({
  key: 'Filters',
  default: {
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getTimestamp(DASHBOARD_DAYS),
    end: getTimestamp(),
    backtestId: null,
  },
});
