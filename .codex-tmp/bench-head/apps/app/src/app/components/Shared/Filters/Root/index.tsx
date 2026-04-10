'use client';

import { PropsWithChildren } from 'react';
import { FiltersContext } from '../context';
import { UIFilters, Items, OnChangeFilters } from '@tradejs/types';

interface RootProps {
  tickers: Items;
  backtestFiles: Items;
  filters: UIFilters;
  onChangeFilters?: OnChangeFilters;
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
