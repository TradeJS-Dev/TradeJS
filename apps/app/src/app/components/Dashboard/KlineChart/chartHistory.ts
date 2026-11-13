import type { Chart, DataLoaderSubscribeBarParams, Period } from 'klinecharts';
import type { Interval, KlineChartData, KlineChartItem } from '@tradejs/types';
import { useEffect, useRef, useState } from 'react';

const calendarPeriods: Partial<Record<Interval, Period['type']>> = {
  D: 'day',
  W: 'week',
  M: 'month',
};

const candleChanged = (previous: KlineChartItem, next: KlineChartItem) =>
  Object.keys(next).length !== Object.keys(previous).length ||
  Object.entries(next).some(
    ([field, value]) => !Object.is(value, previous[field]),
  );

export const useChartHistory = ({
  chart,
  data,
  fulfilled,
  historyKey,
  symbol,
  interval,
  replay,
}: {
  chart: Chart | null;
  data: KlineChartData;
  fulfilled: boolean;
  historyKey: string;
  symbol: string;
  interval: Interval;
  replay: boolean;
}) => {
  const [initialized, setInitialized] = useState<{
    chart: Chart;
    key: string;
  } | null>(null);
  const applied = useRef<{
    chart: Chart;
    key: string;
    data: KlineChartData;
  } | null>(null);
  const update = useRef<DataLoaderSubscribeBarParams['callback'] | null>(null);
  const loadedKey = fulfilled ? historyKey : '';

  useEffect(() => {
    if (!chart) return;

    const previous = applied.current;
    const sameChart = previous?.chart === chart;
    const sameSeries = sameChart && previous.key === loadedKey;
    const oldData = sameSeries ? previous.data : [];
    if (sameSeries && oldData === data) return;
    if (!fulfilled && !sameChart) return;

    const candles = fulfilled ? data : [];
    const lastOldIndex = oldData.length - 1;
    const canAppend =
      sameSeries &&
      lastOldIndex >= 0 &&
      update.current &&
      candles.length >= oldData.length &&
      oldData.every((old, index) => {
        const next = candles[index];
        return (
          old.timestamp === next.timestamp &&
          (index === lastOldIndex || !candleChanged(old, next))
        );
      });

    if (canAppend) {
      const range = chart.getVisibleRange();
      const pinned = lastOldIndex - range.realTo <= 1;
      for (let index = lastOldIndex; index < candles.length; index++) {
        if (
          index > lastOldIndex ||
          candleChanged(oldData[index], candles[index])
        ) {
          update.current?.(candles[index]);
        }
      }
      if (replay && candles.length > oldData.length) chart.scrollToRealTime();
      else if (!pinned)
        chart.scrollToDataIndex(Math.max(0, Math.floor(range.realTo) - 1));
    } else {
      const previousRight =
        sameSeries && !replay
          ? oldData[
              Math.min(
                lastOldIndex,
                Math.floor(chart.getVisibleRange().realTo) - 1,
              )
            ]?.timestamp
          : undefined;
      update.current = null;
      if (chart.getSymbol()?.ticker !== symbol) {
        chart.setSymbol({ ticker: symbol, pricePrecision: 9 });
      }
      const type = calendarPeriods[interval] ?? 'minute';
      const span = type === 'minute' ? Number(interval) : 1;
      const currentPeriod = chart.getPeriod();
      if (currentPeriod?.type !== type || currentPeriod.span !== span) {
        chart.setPeriod({ type, span });
      }
      chart.setDataLoader({
        getBars: ({ callback }) => {
          // KLineChart updates its input array in place when a new candle arrives.
          callback([...candles]);
        },
        subscribeBar: ({ callback }) => {
          update.current = callback;
        },
      });
      if (
        previousRight !== undefined &&
        previousRight < (oldData.at(-1)?.timestamp ?? previousRight)
      ) {
        chart.scrollToTimestamp(previousRight);
      }
    }

    applied.current = { chart, key: loadedKey, data: candles };
    setInitialized((current) =>
      current?.chart === chart && current.key === loadedKey
        ? current
        : { chart, key: loadedKey },
    );
  }, [chart, data, fulfilled, interval, loadedKey, replay, symbol]);

  return Boolean(
    chart &&
      fulfilled &&
      data.length &&
      initialized?.chart === chart &&
      initialized.key === historyKey,
  );
};
