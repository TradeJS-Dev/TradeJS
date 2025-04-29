'use client';

import { useRecoilState } from 'recoil';
import { filtersState } from '@atoms';
import { Select } from '@UI';
import { List } from './list';

export const SelectSymbol = () => {
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
      items={List}
      width="160px"
    />
  );
};
