'use client';

import React from 'react';
import _ from 'lodash';
import { useRecoilValue } from 'recoil';
import { filtersState } from '@atoms';
import { KlineChart } from '@UI'

export const SubChart = () => {
  const filters = useRecoilValue(filtersState);

  return <KlineChart id='sub-chart' filters={{...filters, symbol: 'BTCUSDT' }} />;
};
