import { create } from 'zustand';
import { DASHBOARD_PRELOAD_DAYS } from '@tradejs/core/constants';
import { getTimestamp } from '@tradejs/core/time';
import { Interval } from '@tradejs/types';
import type { UIFilters } from '#app/types/ui';

interface FiltersState {
  filters: UIFilters;
  setFilters: (filters: Partial<UIFilters>) => void;
}

const useStore = create<FiltersState>((set) => ({
  filters: {
    provider: 'bybit',
    universe: 'crypto',
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getTimestamp(DASHBOARD_PRELOAD_DAYS),
    end: getTimestamp(),
    backtestId: null,
    backtestStrategy: null,
  } as UIFilters,
  setFilters: (newFilters) =>
    set(({ filters }) => ({ filters: { ...filters, ...newFilters } })),
}));

export const useFilters = () => {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  return { filters, setFilters };
};
