'use client';

import React, { useEffect } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { filtersState, tickersState, backtestState } from '@atoms';
import { scanner } from '@src/actions/scanner';
import { getBacktestFiles } from '@src/actions/backtest';
import { SelectSymbol, SelectInterval, SelectBacktest, SelectIndicator } from './Filters';
import { MainChart } from './MainChart';

export const Dashboard = () => {
  const { symbol } = useRecoilValue(filtersState);
  const setTickers = useSetRecoilState(tickersState);
  const setBacktest = useSetRecoilState(backtestState);

  useEffect(() => {
    (async () => {
      const tickers = await scanner();

      setTickers((oldState) => ({
        ...oldState,
        scanner: tickers,
      }));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const files = await getBacktestFiles(symbol);

      setBacktest((oldState) => ({
        ...oldState,
        files,
      }));
    })();
  }, [symbol]);

  return (
    <>
      <div className="p-2 flex flex-row gap-8">
        <SelectSymbol />
        <SelectInterval />
        <SelectBacktest />
        <SelectIndicator />
      </div>
      <div className="flex-1 w-full">
        <MainChart />
      </div>
    </>
  );
};
