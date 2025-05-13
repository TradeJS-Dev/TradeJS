import { atom, selector } from 'recoil';
import { Indicators, Items } from '@types';

const LOCAL_STORAGE_KEY = 'indicators';

export const indicatorsState = atom<Indicators>({
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
      periods: [49, 99],
    },
    {
      id: 'wma',
      label: 'WMA',
      enabled: false,
      periods: [49, 99],
    },
  ],
  effects: [
    ({ setSelf, onSet }) => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved != null) {
          try {
            setSelf(JSON.parse(saved));
          } catch (err) {
            console.error('Failed to parse indicators from localStorage:', err);
          }
        }

        onSet((newValue, _, isReset) => {
          if (isReset) {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
          } else {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newValue));
          }
        });
      }
    },
  ],
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
