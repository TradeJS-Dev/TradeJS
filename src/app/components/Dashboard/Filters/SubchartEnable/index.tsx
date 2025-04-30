'use client';

import { useRecoilState } from 'recoil';
import { subchartState } from '@atoms';
import { Switcher } from '@UI';

export const SubchartEnable = () => {
  const [subchart, setSubchart] = useRecoilState(subchartState);

  const onChange = (value: boolean) => {
    setSubchart(() => ({
      enabled: value,
    }));
  };

  return (
    <Switcher defaultValue={subchart.enabled} label="BTC" onChange={onChange} />
  );
};
