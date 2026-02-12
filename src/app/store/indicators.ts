import { useMemo } from 'react';
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
          id: 'spread',
          label: 'Spread',
          enabled: true,
        },
        {
          id: 'vol',
          label: 'Vol',
          enabled: true,
        },
        {
          id: 'resistant',
          label: 'resistant',
          enabled: false,
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
          periods: [49, 200],
        },
        {
          id: 'ema',
          label: 'EMA',
          enabled: false,
          periods: [49, 200],
        },
        {
          id: 'wma',
          label: 'WMA',
          enabled: false,
          periods: [49, 200],
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

  const selectedIndicators = useMemo(
    () => indicators.filter((ind) => ind.enabled).map(({ id }) => id),
    [indicators],
  );

  const indicatorsItems = useMemo(
    () =>
      indicators.map(({ id, label }) => ({
        value: id,
        label,
      })),
    [indicators],
  ) as Items;

  const indicatorsByKey = useMemo(
    () => _.keyBy(indicators, 'id'),
    [indicators],
  );

  return {
    indicators,
    selectedIndicators,
    indicatorsItems,
    indicatorsByKey,
    setEnabledIndicators,
  };
};
