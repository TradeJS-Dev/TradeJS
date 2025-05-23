'use client';

import { useRouter } from 'next/navigation';
import { useRecoilState, useRecoilValue, useSetRecoilState } from 'recoil';
import { filtersState, tickersListSelector, backtestState } from '@atoms';
import { Select } from '@UI';

export const SelectSymbol = () => {
  const router = useRouter();
  const tickers = useRecoilValue(tickersListSelector);
  const [filters, setFilters] = useRecoilState(filtersState);
  const setBacktest = useSetRecoilState(backtestState);

  const onChange = (value: string[]) => {
    setFilters((oldFilters) => ({
      ...oldFilters,
      symbol: value[0],
    }));

    setBacktest((oldState) => ({
      ...oldState,
      id: null,
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
