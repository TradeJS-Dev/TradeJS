'use client';

import { useRouter } from 'next/navigation';
import { useRecoilState, useRecoilValue } from 'recoil';
import { filtersState, tickersListSelector } from '@atoms';
import { Select } from '@UI';

export const SelectSymbol = () => {
  const router = useRouter();
  const tickers = useRecoilValue(tickersListSelector);
  const [filters, setFilters] = useRecoilState(filtersState);

  const onChange = (value: string[]) => {
    setFilters((oldFilters) => ({
      ...oldFilters,
      symbol: value[0],
    }));

    router.replace(`/dashboard/${value[0]}/${filters.interval}`);
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
