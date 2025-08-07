'use client';

import _ from 'lodash';
import { Select } from '@UI';
import { useFilters } from '../context';

export const SelectBacktest = () => {
  const { filters, backtestFiles, onChangeFilters } = useFilters();

  const tests = backtestFiles.filter((file) =>
    file.value.startsWith(filters.symbol),
  );

  if (_.isEmpty(tests)) {
    return null;
  }

  const onChange = (value: string[]) => {
    const newFilters = {
      ...filters,
      backtestId: value[0],
    };

    onChangeFilters?.(newFilters);
  };

  return (
    <Select
      placeholder="Backtest"
      defaultValue={[filters.backtestId || '']}
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
