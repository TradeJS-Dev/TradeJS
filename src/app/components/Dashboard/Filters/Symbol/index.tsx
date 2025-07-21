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
    setFilters((state) => ({
      ...state,
      symbol: value[0],
    }));

    setBacktest((state) => ({
      ...state,
      id: null,
    }));

    window.history.replaceState(
      null,
      '',
      `/dashboard/${value[0]}/${filters.interval}`,
    );
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
