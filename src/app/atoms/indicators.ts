import { atom } from 'recoil';
import { Indicators } from '@types';

export const indicatorsState = atom({
  key: 'Indicators',
  default: {
    vol: {
      enabled: true,
    },
    atr: {
      enabled: true,
      periods: [14],
    },
    ma: {
      enabled: true,
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
