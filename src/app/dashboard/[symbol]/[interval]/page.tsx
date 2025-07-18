'use client';

import React, { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSetRecoilState } from 'recoil';
import { filtersState, tickersState, backtestState } from '@atoms';
import { scanner } from '@src/actions/scanner';
import { getBacktestFiles } from '@src/actions/backtest';
import {
  SelectSymbol,
  SelectInterval,
  SelectBacktest,
  SelectIndicator,
} from '@app/components/Dashboard/Filters';
import { MainChart } from '@app/components/Dashboard/MainChart';
import { useIsClient } from '@app/hooks/isClient';
import { Interval } from '@types';
import { getTimestamp } from '@utils/timestamp';

const Dashboard = () => {
  const isClient = useIsClient();
  const { symbol, interval } = useParams();
  const setFilters = useSetRecoilState(filtersState);
  const setTickers = useSetRecoilState(tickersState);
  const setBacktest = useSetRecoilState(backtestState);

  useEffect(() => {
    if (typeof symbol === 'string' && typeof interval === 'string') {
      setFilters((state) => ({
        ...state,
        symbol,
        interval: interval as Interval,
        end: getTimestamp(),
      }));
    }
  }, [symbol, interval]);

  useEffect(() => {
    (async () => {
      const tickers = await scanner();

      setTickers((state) => ({
        ...state,
        scanner: tickers,
      }));
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const files = await getBacktestFiles(symbol as string);

      setBacktest((state) => ({
        ...state,
        files,
      }));
    })();
  }, [symbol]);

  if (!isClient) {
    return null;
  }

  return (
    <main className="min-h-screen flex flex-col items-start justify-between p-4 bg-zinc-900">
      <div className="p-2 flex flex-row gap-8">
        <SelectSymbol />
        <SelectInterval />
        <SelectIndicator />
        <SelectBacktest />
      </div>
      <div className="flex-1 w-full">
        <MainChart />
      </div>
    </main>
  );
};

export default Dashboard;
