import { createContext, useContext } from 'react';
import { UIFIlters, Items } from '@types';

interface FiltersContextProps {
  filters: UIFIlters;
  tickers: Items;
  backtestFiles: Items;
  onChangeFilters?: (filters: UIFIlters) => void;
}

export const FiltersContext = createContext<FiltersContextProps>(
  {} as FiltersContextProps,
);

export const useFilters = () => {
  return useContext(FiltersContext);
};
