'use client';

import React from 'react';
import _ from 'lodash';
import { useRecoilValue } from 'recoil';
import { filtersState, indicatorsState, backtestState } from '@atoms';
import { KlineChart } from '../KlineChart';

export const MainChart = () => {
  const filters = useRecoilValue(filtersState);
  const backtest = useRecoilValue(backtestState);
  const indicators = useRecoilValue(indicatorsState);

  return (
    <KlineChart
      id="main-chart"
      filters={filters}
      backtestId={backtest.id || undefined}
      indicators={indicators}
    />
  );
};
