'use client';

import React, { useEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { subchartState, tickersState } from '@atoms';
import { scanner } from '@src/actions/scanner';
import { SelectSymbol, SelectInterval, SubchartEnable } from './Filters';
import { MainChart } from './MainChart';
import { SubChart } from './SubChart';

export const Dashboard = () => {
  const subchart = useRecoilValue(subchartState);
  const setTickers = useSetRecoilState(tickersState);

  useEffect(() => {
    (async () => {
      const tickers = await scanner();

      setTickers((oldState) => ({
        ...oldState,
        scanner: tickers,
      }));
    })();
  }, []);

  return (
    <>
      <div className="p-2 flex flex-row gap-8">
        <SelectSymbol />
        <SelectInterval />
        <SubchartEnable />
      </div>
      <div
        key={subchart.enabled ? 'main-chart' : 'chart'}
        className="flex-1 w-full"
      >
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
