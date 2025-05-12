'use client';

import React, { useEffect, useState } from 'react';
import _ from 'lodash';
import { init, Chart, dispose } from 'klinecharts';
import { kline } from '@src/actions/kline';
import { KlineChartData, Indicators, Filters } from '@types';
import {
  BBIndicator,
  AtrIndicator,
  MaIndicator,
  EmaIndicator,
  WmaIndicator,
  VolIndicator,
  Backtest,
} from './indicators';
import { darkTheme } from './styles';

interface KlineChartProps {
  id: string;
  filters: Filters;
  indicators?: Indicators;
  backtestId?: string;
}

export const KlineChart = ({
  id,
  filters,
  indicators,
  backtestId,
}: KlineChartProps) => {
  const [data, setData] = useState<KlineChartData>();

  const updateData = async ({ symbol, interval, start, end }: Filters) => {
    const newData = await kline({
      symbol,
      interval,
      start,
      end,
    });

    setData(newData);
  };

  useEffect(() => {
    updateData(filters);
  }, [filters]);

  useEffect(() => {
    const chartElement = document.getElementById(id);
    if (chartElement && chartElement.parentElement) {
      const parent = chartElement.parentElement;
      const parentStyles = window.getComputedStyle(parent);
      chartElement.style.width = parentStyles.width;
      chartElement.style.height = parentStyles.height;
    }
  }, []);

  useEffect(() => {
    if (!data || _.isEmpty(data)) {
      return () => null;
    }

    const chart = init(id) as Chart;

    chart.setPrecision({ price: 7 });

    chart.applyNewData(data);

    indicators?.forEach((indicator) => {
      if (!indicator.enabled) {
        return;
      }

      if (indicator.id === 'vol') {
        VolIndicator(chart);
      }

      if (indicator.id === 'atr') {
        AtrIndicator(chart, data, indicator.periods!);
      }

      if (indicator.id === 'bb') {
        BBIndicator(chart, data, indicator.periods!);
      }

      if (indicator.id === 'ma') {
        MaIndicator(chart, data, indicator.periods!);
      }

      if (indicator.id === 'ema') {
        EmaIndicator(chart, data, indicator.periods!);
      }

      if (indicator.id === 'wma') {
        WmaIndicator(chart, data, indicator.periods!);
      }
    });

    if (backtestId) {
      Backtest(chart, backtestId);
    }

    darkTheme(chart);

    return () => {
      dispose(id);
    };
  }, [indicators, backtestId, data]);

  return <div id={id} />;
};
