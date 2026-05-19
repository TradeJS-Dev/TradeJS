'use client';

import _ from 'lodash';
import { useIndicators } from '#store';
import { Select } from '#ui';

export const SelectIndicator = () => {
  const { selectedIndicators, indicatorsItems, setEnabledIndicators } =
    useIndicators();

  return (
    <Select
      defaultValue={selectedIndicators}
      onChange={setEnabledIndicators}
      placeholder="Indicators"
      items={indicatorsItems}
      multiple={true}
      width="240px"
    />
  );
};
