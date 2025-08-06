'use client';

import _ from 'lodash';
import { useRecoilState, useRecoilValue } from 'recoil';
import { filtersState, backtestState } from '@atoms';
import { Select } from '@UI';

export const SelectBacktest = () => {
  const filters = useRecoilValue(filtersState);
  const [backtest, setBacktest] = useRecoilState(backtestState);

  const tests = backtest.files.filter((file) =>
    file.value.startsWith(filters.symbol),
  );

  if (_.isEmpty(tests)) {
    return null;
  }

  const onChange = (value: string[]) => {
    setBacktest((state) => ({
      ...state,
      id: value[0],
    }));
  };

  return (
    <Select
      placeholder="Backtest"
      defaultValue={[backtest.id || '']}
      onChange={onChange}
      items={[
        {
          label: 'Not selected',
          value: '',
        },
        ...tests,
      ]}
      width="240px"
    />
  );
};
