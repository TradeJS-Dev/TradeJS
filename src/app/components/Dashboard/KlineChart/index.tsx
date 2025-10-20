'use client';

import React, { useEffect, useRef } from 'react';
import _ from 'lodash';
import { init, Chart, dispose } from 'klinecharts';
import { OverlaySpinner } from '@UI';
import { Indicator, UIFilters } from '@types';
import {
  useBbIndicator,
  useAtrIndicator,
  useMaIndicator,
  useEmaIndicator,
  useWmaIndicator,
  useVolIndicator,
  useBtcIndicator,
  useTrendLine,
  useBacktest,
  useResize,
  useData,
} from './hooks';
import { darkTheme } from './styles';

interface KlineChartProps {
  id: string;
  filters: UIFilters;
  indicators: Record<string, Indicator>;
}

export const KlineChart = ({ id, filters, indicators }: KlineChartProps) => {
  const chartRef = useRef<Chart | null>(null);
  const { data, fulfilled } = useData(chartRef.current, filters);

  useEffect(() => {
    const chart = init(id) as Chart;
    chartRef.current = chart;

    chart.setPrecision({ price: 9 });
    darkTheme(chart);

    return () => {
      dispose(id);
      chartRef.current = null;
    };
  }, []);

  useResize(chartRef, id);

  const chart = chartRef.current;

  useAtrIndicator(chart, indicators.atr.enabled, indicators.atr.periods || []);
  useBbIndicator(chart, indicators.bb.enabled, indicators.bb.periods || []);
  useMaIndicator(chart, indicators.ma.enabled, indicators.ma.periods || []);
  useEmaIndicator(chart, indicators.ema.enabled, indicators.ema.periods || []);
  useWmaIndicator(chart, indicators.wma.enabled, indicators.wma.periods || []);
  useVolIndicator(chart, indicators.vol.enabled);
  useBtcIndicator(chart, indicators.btc.enabled, filters);
  useBacktest(chart, filters.backtestId || undefined);
  useTrendLine(chart, true, data, filters);

  return (
    <>
      <div id={id} />
      {!fulfilled && <OverlaySpinner />}
    </>
  );
};
