'use client';

import _ from 'lodash';
import { useRecoilState } from 'recoil';
import { backtestState } from '@atoms';
import { Select } from '@UI';

export const SelectBacktest = () => {
  const [backtest, setBacktest] = useRecoilState(backtestState);

  if (_.isEmpty(backtest.files)) {
    return null;
  }

  const onChange = (value: string[]) => {
    setBacktest((oldState) => ({
      ...oldState,
      id: value[0],
    }));
  };

  return (
    <Select
      placeholder='Backtest'
      defaultValue={[backtest.id || '']}
      onChange={onChange}
      items={backtest.files}
      width="240px"
    />
  );
};
