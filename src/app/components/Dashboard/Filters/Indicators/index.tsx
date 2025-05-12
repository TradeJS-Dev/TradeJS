'use client';

import _ from 'lodash';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import {
  indicatorsState,
  selectedIndicatorsSelector,
  indicatorsItemsSelector,
} from '@atoms';
import { Select } from '@UI';

export const SelectIndicator = () => {
  const setIndicators = useSetRecoilState(indicatorsState);
  const selected = useRecoilValue(selectedIndicatorsSelector);
  const items = useRecoilValue(indicatorsItemsSelector);

  const onChange = (values: string[]) => {
    setIndicators((oldState) => {
      const clonedState = _.cloneDeep(oldState);

      clonedState.forEach((indicator, i) => {
        clonedState[i].enabled = values.includes(indicator.id);
      });

      return clonedState;
    });
  };

  return (
    <Select
      defaultValue={selected}
      onChange={onChange}
      placeholder='Indicators'
      items={items}
      multiple={true}
      width="240px"
    />
  );
};
