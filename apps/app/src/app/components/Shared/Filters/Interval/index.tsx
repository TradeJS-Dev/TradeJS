'use client';

import { Segment } from '@UI';
import { Interval } from '@tradejs/types';
import { intervals } from './intervals';
import { useFiltersContext } from '../context';

export const SelectInterval = () => {
  const { filters, onChangeFilters } = useFiltersContext();

  const onChange = (value: string | null) => {
    if (!value) {
      return;
    }

    const newFilters = {
      ...filters,
      interval: value as Interval,
    };

    onChangeFilters?.(newFilters);
  };

  return (
    <Segment
      defaultValue={filters.interval}
      onChange={onChange}
      items={intervals}
    />
  );
};
