'use client';

import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { usePathname } from 'next/navigation';
import { filtersState, tickersListSelector, backtestState } from '@atoms';
import { Select } from '@UI';
import { Filters } from '@types';

interface SelectSymbolProps {
  onSelect?: (filters: Filters) => void;
}

export const SelectSymbol = ({ onSelect }: SelectSymbolProps) => {
  const pathname = usePathname();
  const tickers = useRecoilValue(tickersListSelector);
  const [filters, setFilters] = useRecoilState(filtersState);
  const setBacktest = useSetRecoilState(backtestState);

  const onChange = (value: string[]) => {
    const newFilters = {
      ...filters,
      symbol: value[0],
    };

    setFilters(newFilters);

    setBacktest((state) => ({
      ...state,
      id: null,
    }));

    onSelect?.(newFilters);
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
