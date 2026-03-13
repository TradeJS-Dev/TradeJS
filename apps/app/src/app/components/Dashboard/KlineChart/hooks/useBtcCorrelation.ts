import { useCallback, useEffect, useMemo, useRef } from 'react';
import _ from 'lodash';
import { Chart } from 'klinecharts';
import { Filters, Provider } from '@tradejs/types';
import { useData } from '@store';
import { CORRELATION_WINDOW } from '@tradejs/core/constants';
import { getCloseAtOrBefore, grayDashedLineStyle } from './indicatorShared';
import { useManagedIndicator } from './useManagedIndicator';

const WINDOW = CORRELATION_WINDOW;

const pearson = (x: number[], y: number[]) => {
  const len = x.length;
  if (len < 2) return undefined;

  const sumX = x.reduce((acc, value) => acc + value, 0);
  const sumY = y.reduce((acc, value) => acc + value, 0);
  const meanX = sumX / len;
  const meanY = sumY / len;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < len; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;

    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  if (denomX <= 0 || denomY <= 0) return undefined;

  const value = numerator / Math.sqrt(denomX * denomY);
  if (!Number.isFinite(value)) return undefined;

  return Math.max(-1, Math.min(1, value));
};

const buildCorrelationValues = (
  kLineDataList: Array<{ timestamp: number; close: number }>,
  btcByTs: Record<number, { close: number }>,
  btcCandles: Array<{ timestamp: number; close: number }>,
) => {
  const valuesByTs: Record<number, Record<string, number | undefined>> = {};
  const symbolWindow: number[] = [];
  const btcWindow: number[] = [];

  for (let i = 0; i < kLineDataList.length; i++) {
    const candle = kLineDataList[i];
    const btcClose =
      btcByTs[candle.timestamp]?.close ??
      getCloseAtOrBefore(btcCandles, candle.timestamp);

    if (Number.isFinite(candle.close) && Number.isFinite(btcClose)) {
      symbolWindow.push(candle.close);
      btcWindow.push(Number(btcClose));

      if (symbolWindow.length > WINDOW) {
        symbolWindow.shift();
        btcWindow.shift();
      }
    }

    valuesByTs[candle.timestamp] = {
      BTC_CORR: pearson(symbolWindow, btcWindow),
      BTC_CORR_LEVEL: 0.5,
    };
  }

  return valuesByTs;
};

export const useBtcCorrelation = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const indicatorId = 'btc_correlation_indicator';
  const paneId = 'btc_correlation_indicator_pane';
  const btcByTimestampRef = useRef<Record<number, { close: number }>>({});
  const btcCandlesRef = useRef<Array<{ timestamp: number; close: number }>>([]);

  const btcFilters = useMemo(
    () => ({
      ...filters,
      provider: (filters.provider || 'bybit') as Provider,
      symbol: enabled ? 'BTCUSDT' : '',
    }),
    [filters, enabled],
  );

  const { data: btcData } = useData(btcFilters);

  const btcByTimestamp = useMemo(
    () => _.keyBy(btcData, 'timestamp'),
    [btcData],
  );
  const btcCandles = useMemo(
    () =>
      btcData
        .map((candle) => ({ timestamp: candle.timestamp, close: candle.close }))
        .sort((a, b) => a.timestamp - b.timestamp),
    [btcData],
  );

  useEffect(() => {
    btcByTimestampRef.current = btcByTimestamp;
    btcCandlesRef.current = btcCandles;
  }, [btcByTimestamp, btcCandles]);

  const calc = useCallback(
    (kLineDataList: Array<{ timestamp: number; close: number }>) =>
      buildCorrelationValues(
        kLineDataList,
        btcByTimestampRef.current,
        btcCandlesRef.current,
      ),
    [],
  );

  const template = useMemo(
    () => ({
      shortName: 'BTC Correlation',
      calcParams: [],
      figures: [
        {
          key: 'BTC_CORR',
          title: `BTC Correlation(${WINDOW}): `,
          type: 'line',
        },
        {
          key: 'BTC_CORR_LEVEL',
          title: 'Correlation Level(0.5): ',
          type: 'line',
          styles: grayDashedLineStyle,
        },
      ],
    }),
    [],
  );

  useManagedIndicator({
    chart,
    enabled,
    indicatorName: 'BTC_CORRELATION',
    indicatorId,
    paneId,
    template,
    calc,
    updateDeps: [btcData],
  });
};
