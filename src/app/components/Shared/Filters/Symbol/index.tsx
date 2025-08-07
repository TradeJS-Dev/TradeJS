'use client';

import { Select } from '@UI';
import { useFilters } from '../context';

interface SelectSymbolProps {}

export const SelectSymbol = ({}: SelectSymbolProps) => {
  const { filters, tickers, onChangeFilters } = useFilters();

  const onChange = (value: string[]) => {
    const newFilters = {
      ...filters,
      symbol: value[0],
      backtestId: null,
    };

    onChangeFilters?.(newFilters);
  };

  return (
    <Select
      defaultValue={[filters.symbol]}
      onChange={onChange}
      items={tickers}
      width="240px"
    />
  );
};
