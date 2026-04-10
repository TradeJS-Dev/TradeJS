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
import { Indicator, UIFilters } from '@tradejs/types';
import {
  useBbIndicator,
  useAtrIndicator,
  useMaIndicator,
  useEmaIndicator,
  useWmaIndicator,
  useVolIndicator,
  useBtcIndicator,
  useBtcCorrelation,
  useSpreadIndicator,
  useSignal,
  useBacktest,
  useSupportResistanceLines,
  useResize,
  useSetup,
} from './hooks';
import { usePluginIndicators } from './hooks/usePluginIndicators';
import { IndicatorRendererConfig, useData } from '@store';
import { darkTheme } from './styles';

interface KlineChartProps {
  id: string;
  filters: UIFilters;
  indicators: Record<string, Indicator>;
  indicatorRenderers: Record<string, IndicatorRendererConfig>;
}

export const KlineChart = ({
  id,
  filters,
  indicators,
  indicatorRenderers,
}: KlineChartProps) => {
  const chartRef = useRef<Chart | null>(null);
  const { data, key, fulfilled } = useData(filters);
  const updateDataCallback = useRef<
    DataLoaderSubscribeBarParams['callback'] | null
  >(null);
  const RIGHT_EDGE_EPSILON_BARS = 1;

  useEffect(() => {
    const chart = init(id) as Chart;
    chartRef.current = chart;

    darkTheme(chart);

    return () => {
      dispose(id);
      chartRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    if (!chartRef.current || _.isEmpty(data)) {
      return;
    }

    const chart = chartRef.current;
    const currentSymbol = chart.getSymbol()?.ticker;
    const currentInterval = chart.getPeriod()?.span;
    const nextInterval = parseInt(filters.interval, 10);
    const symbolChanged = currentSymbol !== filters.symbol;
    const intervalChanged = currentInterval !== nextInterval;

    if (symbolChanged || intervalChanged) {
      chartRef.current.setSymbol({ ticker: filters.symbol, pricePrecision: 9 });
      chartRef.current.setPeriod({
        span: nextInterval,
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
    const visibleRangeBeforeUpdate = chart.getVisibleRange();
    const maxVisibleDataIndex = currentData.length - 1;
    const wasPinnedToRightEdge =
      maxVisibleDataIndex <= 0 ||
      maxVisibleDataIndex - visibleRangeBeforeUpdate.realTo <=
        RIGHT_EDGE_EPSILON_BARS;
    const dataIndexToKeepVisible = Math.max(
      0,
      Math.min(
        maxVisibleDataIndex,
        Math.floor(visibleRangeBeforeUpdate.realTo),
      ),
    );
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

    if (!wasPinnedToRightEdge) {
      chart.scrollToDataIndex(dataIndexToKeepVisible);
    }
  }, [data, filters.interval, filters.symbol, fulfilled, key]);

  const chart = chartRef.current;

  useResize(chart, id);
  useAtrIndicator(chart, indicators.atr.enabled, indicators.atr.periods || []);
  useBbIndicator(chart, indicators.bb.enabled, indicators.bb.periods || []);
  useMaIndicator(chart, indicators.ma.enabled, indicators.ma.periods || []);
  useEmaIndicator(chart, indicators.ema.enabled, indicators.ema.periods || []);
  useWmaIndicator(chart, indicators.wma.enabled, indicators.wma.periods || []);
  useVolIndicator(chart, indicators.vol.enabled);
  useBtcIndicator(chart, indicators.btc.enabled, filters);
  useBtcCorrelation(chart, indicators.btcCorrelation?.enabled, filters);
  useSpreadIndicator(chart, indicators.spread?.enabled, filters);
  useBacktest(chart, filters.backtestId || undefined);
  useSupportResistanceLines(chart, indicators.resistant?.enabled);
  useSignal(chart, true);
  useSetup(chart, true);
  usePluginIndicators(chart, indicators, indicatorRenderers, data);

  return (
    <>
      <div id={id} />
      {!fulfilled && <OverlaySpinner />}
    </>
  );
};
