'use client';

import React, { useEffect, useState } from 'react';
import _ from 'lodash';
import { init, Chart, dispose } from 'klinecharts';
import { getUnixTime, subDays } from 'date-fns';
import { kline } from '@src/actions/kline';
import { KlineChartData } from '@src/types';
import { SelectSymbol } from '@components/filters/Symbol';
import {
  MaIndicator,
  EmaIndicator,
  WmaIndicator,
  VolIndicator,
  Backtest,
} from './indicators';
import { config } from '@app/config';
import { darkTheme } from './styles';

export const KlineChart = () => {
  const [data, setData] = useState<KlineChartData>();

  const updateData = async () => {
    const start = getUnixTime(subDays(new Date(), 2)) * 1000;
    const end = getUnixTime(new Date()) * 1000;

    const newData = await kline({
      symbol: config.filters.symbol,
      interval: config.filters.interval,
      start,
      end,
    });

    setData(newData);
  };

  useEffect(() => {
    updateData();
  }, []);

  useEffect(() => {
    const chartElement = document.getElementById('chart');
    if (chartElement && chartElement.parentElement) {
      const parent = chartElement.parentElement;
      const parentStyles = window.getComputedStyle(parent);
      chartElement.style.width = parentStyles.width;
      chartElement.style.height = parentStyles.height;
    }
  }, []);

  useEffect(() => {
    // initialize the chart
    if (!data || _.isEmpty(data)) {
      return () => null;
    }

    const chart = init('chart') as Chart;

    // add data to the chart
    chart.applyNewData(data);

    const { indicators, backtest } = config;

    if (indicators.vol.enabled) {
      VolIndicator(chart);
    }

    if (indicators.ma.enabled) {
      MaIndicator(chart, data, indicators.ma.periods);
    }

    if (indicators.ema.enabled) {
      EmaIndicator(chart, data, indicators.ema.periods);
    }

    if (indicators.wma.enabled) {
      WmaIndicator(chart, data, indicators.wma.periods);
    }

    if (backtest.enabled) {
      Backtest(chart, backtest.symbol, backtest.id);
    }

    darkTheme(chart);

    // chart.createIndicator('SAR', true, { id: 'candle_pane' });

    return () => {
      // destroy chart
      dispose('chart');
    };
  }, [data]);

  return (
    <>
      <div className="p-2">
        <SelectSymbol />
      </div>
      <div className="flex-1 w-full">
        <div id="chart" />
      </div>
    </>
  );
};
