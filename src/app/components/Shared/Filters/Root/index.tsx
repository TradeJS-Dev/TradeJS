'use client';

import { PropsWithChildren } from 'react';
import { FiltersContext } from '../context';
import { UIFIlters, Items } from '@types';

interface RootProps {
  tickers: Items;
  backtestFiles: Items;
  filters: UIFIlters;
  onChangeFilters?: (filters: UIFIlters) => void;
}

export const Root = ({
  filters,
  tickers,
  backtestFiles,
  onChangeFilters,
  children,
}: PropsWithChildren<RootProps>) => {
  return (
    <FiltersContext.Provider
      value={{ filters, tickers, backtestFiles, onChangeFilters }}
    >
      {children}
    </FiltersContext.Provider>
  );
};
