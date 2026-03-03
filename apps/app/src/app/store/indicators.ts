import { useEffect, useMemo, useRef } from 'react';
import _ from 'lodash';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Indicators, Items } from '@types';

const LOCAL_STORAGE_KEY = 'indicators';

interface IndicatorsState {
  indicators: Indicators;
  setEnabledIndicators: (values: string[]) => void;
  upsertIndicators: (items: Indicators) => void;
}

const useStore = create<IndicatorsState>()(
  persist(
    (set) => ({
      indicators: [
        {
          id: 'btc',
          label: 'BTC',
          enabled: false,
        },
        {
          id: 'btcCorrelation',
          label: 'BTC Correlation',
          enabled: false,
        },
        {
          id: 'spread',
          label: 'Spread',
          enabled: false,
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
      upsertIndicators: (items: Indicators) =>
        set((state) => {
          if (!items.length) {
            return state;
          }

          const next = structuredClone(state.indicators);
          const indexById = new Map(
            next.map((indicator, index) => [indicator.id, index]),
          );

          for (const incoming of items) {
            if (!incoming?.id) continue;

            const existingIndex = indexById.get(incoming.id);
            if (existingIndex == null) {
              next.push({
                id: incoming.id,
                label: incoming.label,
                enabled: Boolean(incoming.enabled),
                periods: incoming.periods,
              });
              indexById.set(incoming.id, next.length - 1);
              continue;
            }

            const existing = next[existingIndex];
            next[existingIndex] = {
              ...existing,
              label: incoming.label || existing.label,
              periods: incoming.periods || existing.periods,
            };
          }

          return { indicators: next };
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
  const upsertIndicators = useStore((s) => s.upsertIndicators);
  const catalogRequestedRef = useRef(false);

  useEffect(() => {
    if (catalogRequestedRef.current) return;
    catalogRequestedRef.current = true;

    fetch('/api/indicators')
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json();
        return Array.isArray(payload?.data) ? (payload.data as Indicators) : [];
      })
      .then((items) => {
        if (items.length) {
          upsertIndicators(items);
        }
      })
      .catch(() => undefined);
  }, [upsertIndicators]);

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
