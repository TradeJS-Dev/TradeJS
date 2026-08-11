import { createContext, useContext } from 'react';
import type { Items, OnChangeFilters, UIFilters } from '#app/types/ui';

interface FiltersContextProps {
  filters: UIFilters;
  tickers: Items;
  backtestFiles: Items;
  onChangeFilters?: OnChangeFilters;
  ensureTickersLoaded?: () => void | Promise<unknown>;
  ensureBacktestsLoaded?: () => void | Promise<unknown>;
}

export const FiltersContext = createContext<FiltersContextProps>(
  {} as FiltersContextProps,
);

export const useFiltersContext = () => {
  return useContext(FiltersContext);
};
