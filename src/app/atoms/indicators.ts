import { atom, selector } from 'recoil';
import { Indicators, Items } from '@types';

export const indicatorsState = atom({
  key: 'Indicators',
  default: [
    {
      id: 'vol',
      label: 'Vol',
      enabled: true,
    },
    {
      id: 'atr',
      label: 'ATR',
      enabled: false,
      periods: [14],
    },
    {
      id: 'bb',
      label: 'BB',
      enabled: false,
      periods: [20],
    },
    {
      id: 'ma',
      label: 'MA',
      enabled: false,
      periods: [49, 99],
    },
    {
      id: 'ema',
      label: 'EMA',
      enabled: false,
      periods: [2, 30],
    },
    {
      id: 'wma',
      label: 'WMA',
      enabled: false,
      periods: [2, 40],
    },
  ] as Indicators,
});

export const selectedIndicatorsSelector = selector({
  key: 'SelectedIndicators',
  get: ({ get }) => {
    const indicators = get(indicatorsState);
    return indicators.filter((ind) => ind.enabled).map(({ id }) => id);
  },
});

export const indicatorsItemsSelector = selector({
  key: 'IndicatorsItems',
  get: ({ get }) => {
    const indicators = get(indicatorsState);
    return indicators.map(({ id, label }) => ({
      value: id,
      label,
    })) as Items;
  },
});
