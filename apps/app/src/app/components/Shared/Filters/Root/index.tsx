'use client';

import { PropsWithChildren } from 'react';
import { FiltersContext } from '../context';
import type { Items, OnChangeFilters, UIFilters } from '#app/types/ui';

interface RootProps {
  tickers: Items;
  backtestFiles: Items;
  filters: UIFilters;
  onChangeFilters?: OnChangeFilters;
  ensureTickersLoaded?: () => void | Promise<unknown>;
  ensureBacktestsLoaded?: () => void | Promise<unknown>;
}

export const Root = ({
  filters,
  tickers,
  backtestFiles,
  onChangeFilters,
  ensureTickersLoaded,
  ensureBacktestsLoaded,
  children,
}: PropsWithChildren<RootProps>) => {
  return (
    <FiltersContext.Provider
      value={{
        filters,
        tickers,
        backtestFiles,
        onChangeFilters,
        ensureTickersLoaded,
        ensureBacktestsLoaded,
      }}
    >
      {children}
    </FiltersContext.Provider>
  );
};
