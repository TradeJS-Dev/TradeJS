import { atom } from 'recoil';
import { Indicators } from '@types';

export const indicatorsState = atom({
  key: 'Indicators',
  default: {
    vol: {
      enabled: true,
    },
    atr: {
      enabled: false,
      periods: [14],
    },
    bb: {
      enabled: false,
      periods: [20],
    },
    ma: {
      enabled: false,
      periods: [49, 99],
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
