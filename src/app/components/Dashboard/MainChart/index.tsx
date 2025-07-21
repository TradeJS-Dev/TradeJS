'use client';

import React from 'react';
import _ from 'lodash';
import { useRecoilValue } from 'recoil';
import { filtersState, indicatorsByKeySelector, backtestState } from '@atoms';
import { KlineChart } from '../KlineChart';

export const MainChart = () => {
  const filters = useRecoilValue(filtersState);
  const backtest = useRecoilValue(backtestState);
  const indicators = useRecoilValue(indicatorsByKeySelector);

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      backtestId={backtest.id || undefined}
      indicators={indicators}
    />
  );
};
