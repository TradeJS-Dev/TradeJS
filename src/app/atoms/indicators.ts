import { atom } from 'recoil';
import { Indicators } from '@types';

export const indicatorsState = atom({
  key: 'Indicators',
  default: {
    vol: {
      enabled: true,
    },
    ma: {
      enabled: true,
      periods: [2, 99],
    },
    ema: {
      enabled: false,
      periods: [2, 30],
    },
    wma: {
      enabled: false,
      periods: [2, 40],
    },
  } as Indicators,
});
