'use client';

import React, { useEffect, useRef } from 'react';
import _ from 'lodash';
import {
  init,
  Chart,
  dispose,
  DataLoaderSubscribeBarParams,
} from 'klinecharts';
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
  useSupportResistanceLines,
  useResize,
} from './hooks';
import { useData } from '@store';
import { darkTheme } from './styles';

interface KlineChartProps {
  id: string;
  filters: UIFilters;
  indicators: Record<string, Indicator>;
}

export const KlineChart = ({ id, filters, indicators }: KlineChartProps) => {
  const chartRef = useRef<Chart | null>(null);
  const { data, key, fulfilled } = useData(filters);
  const updateDataCallback = useRef<
    DataLoaderSubscribeBarParams['callback'] | null
  >(null);

  useEffect(() => {
    const chart = init(id) as Chart;
    chartRef.current = chart;

    darkTheme(chart);

    return () => {
      dispose(id);
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || _.isEmpty(data)) {
      return;
    }

    const chart = chartRef.current;
    const currentSymbol = chart.getSymbol()?.ticker;
    const currenInterval = chart.getPeriod()?.span;

    if (`${currentSymbol}_${currenInterval}` !== key) {
      chartRef.current.setSymbol({ ticker: filters.symbol, pricePrecision: 9 });
      chartRef.current.setPeriod({
        span: Number.parseInt(filters.interval),
        type: 'minute',
      });

      chartRef.current.setDataLoader({
        getBars: ({ callback }) => {
          callback(data);
        },
        subscribeBar: ({ callback }) => {
          updateDataCallback.current = callback;
        },
      });

      return;
    }

    if (!fulfilled || !updateDataCallback.current) {
      return;
    }

    const currentData = chart.getDataList();
    const dataByTimestamp = _.keyBy(currentData, 'timestamp');

    const updatedCandles = data.filter((c) => {
      const prevCandle = dataByTimestamp[c.timestamp];

      if (!prevCandle) {
        return true;
      }

      if (
        prevCandle.close !== c.close ||
        prevCandle.open !== c.open ||
        prevCandle.high !== c.high ||
        prevCandle.low !== c.low ||
        prevCandle.volume !== c.volume
      ) {
        return true;
      }

      return false;
    });

    updatedCandles.forEach((candle) => {
      updateDataCallback.current?.(candle);
    });
  }, [key, data, fulfilled]);

  const chart = chartRef.current;

  useResize(chart, id);
  useAtrIndicator(chart, indicators.atr.enabled, indicators.atr.periods || []);
  useBbIndicator(chart, indicators.bb.enabled, indicators.bb.periods || []);
  useMaIndicator(chart, indicators.ma.enabled, indicators.ma.periods || []);
  useEmaIndicator(chart, indicators.ema.enabled, indicators.ema.periods || []);
  useWmaIndicator(chart, indicators.wma.enabled, indicators.wma.periods || []);
  useVolIndicator(chart, indicators.vol.enabled);
  useBtcIndicator(chart, indicators.btc.enabled, filters);
  useBacktest(chart, filters.backtestId || undefined);
  useSupportResistanceLines(chart, indicators.resistant?.enabled, data);
  useTrendLine(chart, true, data, filters);

  return (
    <>
      <div id={id} />
      {!fulfilled && <OverlaySpinner />}
    </>
  );
};
