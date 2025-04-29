'use client';

import { useRecoilState } from 'recoil';
import { filtersState } from '@atoms';
import { Select } from '@UI';
import { List } from './list';

const items = List.map((value) => ({
  label: value,
  value,
}));

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
      items={items}
      width="160px"
    />
  );
};
