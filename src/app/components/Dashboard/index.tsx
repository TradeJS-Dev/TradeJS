'use client';

import React from 'react';
import { useRecoilValue } from 'recoil';
import { subchartState } from '@atoms';
import { SelectSymbol, SelectInterval, SubchartEnable } from './Filters';
import { MainChart } from './MainChart';
import { SubChart } from './SubChart';

export const Dashboard = () => {
  const subchart = useRecoilValue(subchartState);

  return (
    <>
      <div className="p-2 flex flex-row gap-8">
        <SelectSymbol />
        <SelectInterval />
        <SubchartEnable />
      </div>
      <div key={subchart.enabled ? 'main-chart' : 'chart'} className="flex-1 w-full">
        <MainChart />
      </div>
      {subchart.enabled && (
        <div className="flex-1 w-full">
          <SubChart />
        </div>
      )}
    </>
  );
};
