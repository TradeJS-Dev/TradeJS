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

    if (indicators?.vol.enabled) {
      VolIndicator(chart);
    }

    if (indicators?.atr.enabled) {
      AtrIndicator(chart, data, indicators.atr.periods);
    }

    if (indicators?.bb.enabled) {
      BBIndicator(chart, data, indicators.bb.periods);
    }

    if (indicators?.ma.enabled) {
      MaIndicator(chart, data, indicators.ma.periods);
    }

    if (indicators?.ema.enabled) {
      EmaIndicator(chart, data, indicators.ema.periods);
    }

    if (indicators?.wma.enabled) {
      WmaIndicator(chart, data, indicators.wma.periods);
    }

    if (backtestId) {
      Backtest(chart, backtestId);
    }

    darkTheme(chart);

    return () => {
      dispose(id);
    };
  }, [backtestId, data]);

  return <div id={id} />;
};
