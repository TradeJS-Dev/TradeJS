'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import _ from 'lodash';
import {
  init,
  Chart,
  dispose,
  DataLoaderSubscribeBarParams,
} from 'klinecharts';
import { OverlaySpinner } from '#ui';
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
  useDashboardSignal,
  useSignalFigures,
  useBacktest,
  useSupportResistanceLines,
  useResize,
  useTradeSetup,
} from './hooks';
import { usePluginIndicators } from './hooks/usePluginIndicators';
import { IndicatorRendererConfig, useData } from '#store';
import { darkTheme } from './styles';

interface KlineChartProps {
  id: string;
  filters: UIFilters;
  indicators: Record<string, Indicator>;
  indicatorRenderers: Record<string, IndicatorRendererConfig>;
  live?: boolean;
}

export const KlineChart = ({
  id,
  filters,
  indicators,
  indicatorRenderers,
  live = true,
}: KlineChartProps) => {
  const [chart, setChart] = useState<Chart | null>(null);
  const [initializedHistory, setInitializedHistory] = useState<{
    chart: Chart;
    key: string;
  } | null>(null);
  const { data, key, fulfilled } = useData(filters, live);
  const searchParams = useSearchParams();
  const signalId = searchParams.get('signalId');
  const autoZoom = searchParams.get('autoZoom') === 'true';
  const dashboardSignal = useDashboardSignal({
    symbol: filters.symbol,
    signalId,
  });
  const updateDataCallback = useRef<
    DataLoaderSubscribeBarParams['callback'] | null
  >(null);
  const RIGHT_EDGE_EPSILON_BARS = 1;
  const historyKey = `${id}:${key}:${filters.symbol}:${filters.interval}`;
  const historyReady = Boolean(
    chart &&
      fulfilled &&
      !_.isEmpty(data) &&
      initializedHistory?.chart === chart &&
      initializedHistory.key === historyKey,
  );

  useEffect(() => {
    const nextChart = init(id) as Chart;
    setChart(nextChart);

    darkTheme(nextChart);

    return () => {
      dispose(id);
      setChart((current) => (current === nextChart ? null : current));
    };
  }, [id]);

  useEffect(() => {
    if (!chart || !fulfilled || _.isEmpty(data)) {
      return;
    }

    const currentSymbol = chart.getSymbol()?.ticker;
    const currentInterval = chart.getPeriod()?.span;
    const nextInterval = parseInt(filters.interval, 10);
    const symbolChanged = currentSymbol !== filters.symbol;
    const intervalChanged = currentInterval !== nextInterval;

    if (symbolChanged || intervalChanged) {
      chart.setSymbol({ ticker: filters.symbol, pricePrecision: 9 });
      chart.setPeriod({
        span: nextInterval,
        type: 'minute',
      });

      chart.setDataLoader({
        getBars: ({ callback }) => {
          callback(data);
          setInitializedHistory((current) =>
            current?.chart === chart && current.key === historyKey
              ? current
              : { chart, key: historyKey },
          );
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
    setInitializedHistory((current) =>
      current?.chart === chart && current.key === historyKey
        ? current
        : { chart, key: historyKey },
    );
  }, [chart, data, filters.interval, filters.symbol, fulfilled, historyKey]);

  useResize(chart, id);
  useAtrIndicator(chart, indicators.atr.enabled, indicators.atr.periods || []);
  useBbIndicator(chart, indicators.bb.enabled, indicators.bb.periods || []);
  useMaIndicator(chart, indicators.ma.enabled, indicators.ma.periods || []);
  useEmaIndicator(chart, indicators.ema.enabled, indicators.ema.periods || []);
  useWmaIndicator(chart, indicators.wma.enabled, indicators.wma.periods || []);
  useVolIndicator(chart, indicators.vol.enabled);
  useBtcIndicator(chart, indicators.btc.enabled, filters);
  useBtcCorrelation(
    chart,
    indicators.btcCorrelation?.enabled && filters.universe !== 'tradfi',
    filters,
  );
  useSpreadIndicator(
    chart,
    indicators.spread?.enabled && filters.universe !== 'tradfi',
    filters,
  );
  useBacktest(chart, filters.backtestId || undefined);
  useSupportResistanceLines(chart, indicators.resistant?.enabled);
  const signalReady =
    dashboardSignal.status === 'loaded' && dashboardSignal.signal != null;
  const signalFiguresReady = useSignalFigures({
    chart,
    lastDataTimestamp: data.at(-1)?.timestamp ?? null,
    enabled: historyReady && signalReady,
    signal: dashboardSignal.signal,
    autoZoom,
  });
  const tradeSetupReady = useTradeSetup({
    chart,
    enabled: historyReady && signalReady,
    signal: dashboardSignal.signal,
  });
  usePluginIndicators(chart, indicators, indicatorRenderers, data);

  const screenshotReady = signalId
    ? historyReady && signalReady && signalFiguresReady && tradeSetupReady
    : historyReady;

  return (
    <>
      <div
        id={id}
        data-testid="market-chart"
        data-chart-ready={historyReady ? 'true' : 'false'}
        data-signal-status={dashboardSignal.status}
        data-screenshot-ready={screenshotReady ? 'true' : 'false'}
      />
      {!fulfilled && <OverlaySpinner />}
    </>
  );
};
