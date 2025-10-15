import _ from 'lodash';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Indicators, Items } from '@types';

const LOCAL_STORAGE_KEY = 'indicators';

interface IndicatorsState {
  indicators: Indicators;
  setEnabledIndicators: (values: string[]) => void;
}

const useStore = create<IndicatorsState>()(
  persist(
    (set) => ({
      indicators: [
        {
          id: 'btc',
          label: 'BTC',
          enabled: true,
        },
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
      ] as Indicators,
      setEnabledIndicators: (values: string[]) =>
        set((state) => {
          const clonedState = structuredClone(state.indicators);

          clonedState.forEach((indicator, i) => {
            clonedState[i].enabled = values.includes(indicator.id);
          });

          return { indicators: clonedState };
        }),
    }),
    {
      name: LOCAL_STORAGE_KEY,
    },
  ),
);

export const useIndicators = () => {
  const indicators = useStore((s) => s.indicators);
  const setEnabledIndicators = useStore((s) => s.setEnabledIndicators);

  const selectedIndicators = indicators
    .filter((ind) => ind.enabled)
    .map(({ id }) => id);
  const indicatorsItems = indicators.map(({ id, label }) => ({
    value: id,
    label,
  })) as Items;
  const indicatorsByKey = _.keyBy(indicators, 'id');

  return {
    indicators,
    selectedIndicators,
    indicatorsItems,
    indicatorsByKey,
    setEnabledIndicators,
  };
};
