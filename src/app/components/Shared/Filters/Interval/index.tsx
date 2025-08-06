'use client';

import { useRecoilState } from 'recoil';
import { usePathname } from 'next/navigation';
import { filtersState } from '@atoms';
import { Segment } from '@UI';
import { Interval, Filters } from '@types';
import { intervals } from './intervals';

interface SelectIntervalProps {
  onSelect?: (filters: Filters) => void;
}

export const SelectInterval = ({ onSelect }: SelectIntervalProps) => {
  const pathname = usePathname();
  const [filters, setFilters] = useRecoilState(filtersState);

  const onChange = (value: string | null) => {
    if (!value) {
      return;
    }

    const newFilters = {
      ...filters,
      interval: value as Interval,
    };

    setFilters(newFilters);

    onSelect?.(newFilters);
  };

  return (
    <Segment
      defaultValue={filters.interval}
      onChange={onChange}
      items={intervals}
    />
  );
};
