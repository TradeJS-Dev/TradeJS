import { createContext, useContext } from 'react';
import { UIFilters, Items, OnChangeFilters } from '@types';

interface FiltersContextProps {
  filters: UIFilters;
  tickers: Items;
  backtestFiles: Items;
  onChangeFilters?: OnChangeFilters;
}

export const FiltersContext = createContext<FiltersContextProps>(
  {} as FiltersContextProps,
);

export const useFiltersContext = () => {
  return useContext(FiltersContext);
};
