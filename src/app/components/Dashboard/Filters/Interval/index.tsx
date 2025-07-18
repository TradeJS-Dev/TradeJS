'use client';

import { useRouter } from 'next/navigation';
import { useRecoilState } from 'recoil';
import { filtersState } from '@atoms';
import { Segment } from '@UI';
import { Interval } from '@types';
import { intervals } from './intervals';

export const SelectInterval = () => {
  const router = useRouter();
  const [filters, setFilters] = useRecoilState(filtersState);

  const onChange = (value: string | null) => {
    if (!value) {
      return;
    }

    setFilters((state) => ({
      ...state,
      interval: value as Interval,
    }));

    router.replace(`/dashboard/${filters.symbol}/${value}`);
  };

  return (
    <Segment
      defaultValue={filters.interval}
      onChange={onChange}
      items={intervals}
    />
  );
};
