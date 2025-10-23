'use client';

import _ from 'lodash';
import { useMemo } from 'react';
import { SelectWithSearch } from '@UI';
import { useFiltersContext } from '../context';

interface SelectSymbolProps {}

export const SelectSymbol = ({}: SelectSymbolProps) => {
  const { filters, tickers, onChangeFilters } = useFiltersContext();
  const defaultValue = useMemo(() => [filters.symbol], [filters.symbol]);

  const onChange = (value: string[]) => {
    if (_.isEmpty(value)) {
      return;
    }

    const newFilters = {
      symbol: value[0],
      backtestId: null,
    };

    onChangeFilters?.(newFilters);
  };

  return (
    <SelectWithSearch
      defaultValue={defaultValue}
      onChange={onChange}
      items={tickers}
      width="240px"
    />
  );
};
