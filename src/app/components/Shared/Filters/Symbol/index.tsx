'use client';

import _ from 'lodash';
import { SelectWithSearch } from '@UI';
import { useFiltersContext } from '../context';

interface SelectSymbolProps {}

export const SelectSymbol = ({}: SelectSymbolProps) => {
  const { filters, tickers, onChangeFilters } = useFiltersContext();

  const onChange = (value: string[]) => {
    if (_.isEmpty(value)) {
      return;
    }

    const newFilters = {
      ...filters,
      symbol: value[0],
      backtestId: null,
    };

    onChangeFilters?.(newFilters);
  };

  return (
    <SelectWithSearch
      defaultValue={[filters.symbol]}
      onChange={onChange}
      items={tickers}
      width="240px"
    />
  );
};
