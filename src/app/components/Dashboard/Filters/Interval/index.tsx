'use client';

import { useRecoilState } from 'recoil';
import { filtersState } from '@atoms';
import { Segment } from '@UI';
import { Interval } from '@types';
import { List } from './list';

export const SelectInterval = () => {
  const [filters, setFilters] = useRecoilState(filtersState);

  const onChange = (value: string | null) => {
    if (!value) {
      return;
    }

    setFilters((oldFilters) => ({
      ...oldFilters,
      interval: value as Interval,
    }));
  };

  return (
    <Segment defaultValue={filters.interval} onChange={onChange} items={List} />
  );
};
