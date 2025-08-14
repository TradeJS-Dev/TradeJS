'use client';

import _ from 'lodash';
import { useIndicators } from '@store';
import { Select } from '@UI';

export const SelectIndicator = () => {
  const { selectedIndicators, indicatorsItems, setIndicators } =
    useIndicators();

  return (
    <Select
      defaultValue={selectedIndicators}
      onChange={setIndicators}
      placeholder="Indicators"
      items={indicatorsItems}
      multiple={true}
      width="240px"
    />
  );
};
