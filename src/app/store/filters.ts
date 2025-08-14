import { create } from 'zustand';
import { DASHBOARD_DAYS } from '@constants';
import { getTimestamp } from '@utils/timestamp';
import { Interval, UIFilters } from '@types';

interface FiltersState {
  filters: UIFilters;
  setFilters: (filters: Partial<UIFilters>) => void;
}

const useStore = create<FiltersState>((set) => ({
  filters: {
    symbol: 'BTCUSDT',
    interval: '15' as Interval,
    start: getTimestamp(DASHBOARD_DAYS),
    end: getTimestamp(),
    backtestId: null,
  } as UIFilters,
  setFilters: (newFilters) =>
    set(({ filters }) => ({ filters: { ...filters, ...newFilters } })),
}));

export const useFilters = () => {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  return { filters, setFilters };
};
