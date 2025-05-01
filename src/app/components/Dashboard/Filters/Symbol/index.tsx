'use client';

import { useRecoilState, useRecoilValue } from 'recoil';
import { filtersState, tickersState } from '@atoms';
import { Select } from '@UI';

export const SelectSymbol = () => {
  const tickers = useRecoilValue(tickersState);
  const [filters, setFilters] = useRecoilState(filtersState);

  const onChange = (value: string[]) => {
    setFilters((oldFilters) => ({
      ...oldFilters,
      symbol: value[0],
    }));
  };

  return (
    <Select
      defaultValue={[filters.symbol]}
      onChange={onChange}
      items={tickers.list}
      width="200px"
    />
  );
};
