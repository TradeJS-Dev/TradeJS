import { useEffect, useMemo, useRef, useState } from 'react';
import _ from 'lodash';
import { registerIndicator, Chart } from 'klinecharts';
import { Filters, Provider } from '@types';
import { useData } from '@store';

const getCloseAtOrBefore = (
  candles: Array<{ timestamp: number; close: number }>,
  timestamp: number,
) => {
  let left = 0;
  let right = candles.length - 1;
  let result: number | undefined;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candle = candles[mid];

    if (candle.timestamp <= timestamp) {
      result = candle.close;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

const buildBtcValues = (
  kLineDataList: Array<{ timestamp: number }>,
  bybitByTs: Record<number, { close: number }>,
  binanceByTs: Record<number, { close: number }>,
  coinbaseByTs: Record<number, { close: number }>,
  bybitCandles: Array<{ timestamp: number; close: number }>,
  binanceCandles: Array<{ timestamp: number; close: number }>,
  coinbaseCandles: Array<{ timestamp: number; close: number }>,
) => {
  return kLineDataList.reduce<Record<number, Record<string, number | undefined>>>(
    (acc, { timestamp }) => {
      const bybitValue =
        bybitByTs[timestamp]?.close ??
        getCloseAtOrBefore(bybitCandles, timestamp);
      const binanceValue =
        binanceByTs[timestamp]?.close ??
        getCloseAtOrBefore(binanceCandles, timestamp);
      const coinbaseValue =
        coinbaseByTs[timestamp]?.close ??
        getCloseAtOrBefore(coinbaseCandles, timestamp);

      acc[timestamp] = {
        BTC_BYBIT: bybitValue,
        BTC_BINANCE: binanceValue,
        BTC_COINBASE: coinbaseValue,
      };

      return acc;
    },
    {},
  );
};

export const useBtcIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const [registered, setRegistered] = useState(false);
  const bybitByTimestampRef = useRef<Record<number, { close: number }>>({});
  const binanceByTimestampRef = useRef<Record<number, { close: number }>>({});
  const coinbaseByTimestampRef = useRef<Record<number, { close: number }>>({});
  const bybitCandlesRef = useRef<Array<{ timestamp: number; close: number }>>(
    [],
  );
  const binanceCandlesRef = useRef<Array<{ timestamp: number; close: number }>>(
    [],
  );
  const coinbaseCandlesRef = useRef<
    Array<{ timestamp: number; close: number }>
  >([]);

  const btcFilters = useMemo(
    () => ({
      bybit: {
        ...filters,
        provider: 'bybit' as Provider,
        symbol: 'BTCUSDT',
      },
      binance: {
        ...filters,
        provider: 'binance' as Provider,
        symbol: 'BTCUSDT',
      },
      coinbase: {
        ...filters,
        provider: 'coinbase' as Provider,
        symbol: 'BTCUSDT',
      },
    }),
    [filters],
  );

  const { data: bybitData } = useData(btcFilters.bybit);
  const { data: binanceData } = useData(btcFilters.binance);
  const { data: coinbaseData } = useData(btcFilters.coinbase);

  const bybitByTimestamp = useMemo(
    () => _.keyBy(bybitData, 'timestamp'),
    [bybitData],
  );
  const bybitCandles = useMemo(
    () =>
      bybitData
        .map((candle) => ({ timestamp: candle.timestamp, close: candle.close }))
        .sort((a, b) => a.timestamp - b.timestamp),
    [bybitData],
  );
  const binanceByTimestamp = useMemo(
    () => _.keyBy(binanceData, 'timestamp'),
    [binanceData],
  );
  const binanceCandles = useMemo(
    () =>
      binanceData
        .map((candle) => ({ timestamp: candle.timestamp, close: candle.close }))
        .sort((a, b) => a.timestamp - b.timestamp),
    [binanceData],
  );
  const coinbaseByTimestamp = useMemo(
    () => _.keyBy(coinbaseData, 'timestamp'),
    [coinbaseData],
  );
  const coinbaseCandles = useMemo(
    () =>
      coinbaseData
        .map((candle) => ({ timestamp: candle.timestamp, close: candle.close }))
        .sort((a, b) => a.timestamp - b.timestamp),
    [coinbaseData],
  );

  useEffect(() => {
    bybitByTimestampRef.current = bybitByTimestamp;
    binanceByTimestampRef.current = binanceByTimestamp;
    coinbaseByTimestampRef.current = coinbaseByTimestamp;
    bybitCandlesRef.current = bybitCandles;
    binanceCandlesRef.current = binanceCandles;
    coinbaseCandlesRef.current = coinbaseCandles;
  }, [
    bybitByTimestamp,
    binanceByTimestamp,
    coinbaseByTimestamp,
    bybitCandles,
    binanceCandles,
    coinbaseCandles,
  ]);

  useEffect(() => {
    if (registered) {
      return;
    }

    registerIndicator({
      name: 'BTC',
      shortName: 'BTC',
      calcParams: [],
      figures: [
        {
          key: 'BTC_BYBIT',
          title: 'BTC ByBit: ',
          type: 'line',
        },
        {
          key: 'BTC_BINANCE',
          title: 'BTC Binance: ',
          type: 'line',
        },
        {
          key: 'BTC_COINBASE',
          title: 'BTC Coinbase: ',
          type: 'line',
        },
      ],

      // Calculation results
      calc: (kLineDataList) => {
        return buildBtcValues(
          kLineDataList,
          bybitByTimestampRef.current,
          binanceByTimestampRef.current,
          coinbaseByTimestampRef.current,
          bybitCandlesRef.current,
          binanceCandlesRef.current,
          coinbaseCandlesRef.current,
        );
      },
    });

    setRegistered(true);
  }, [registered]);

  useEffect(() => {
    if (!registered || !chart || !enabled) {
      return;
    }

    chart.removeIndicator({ name: 'BTC' });
    chart.createIndicator('BTC', true, { minHeight: 100 });

    return () => {
      chart.removeIndicator({ name: 'BTC' });
    };
  }, [chart, enabled, registered]);

  useEffect(() => {
    if (!registered || !chart || !enabled) {
      return;
    }

    const updated = chart.overrideIndicator({
      name: 'BTC',
      calc: (kLineDataList) =>
        buildBtcValues(
          kLineDataList,
          bybitByTimestampRef.current,
          binanceByTimestampRef.current,
          coinbaseByTimestampRef.current,
          bybitCandlesRef.current,
          binanceCandlesRef.current,
          coinbaseCandlesRef.current,
        ),
    });
    if (!updated) {
      chart.removeIndicator({ name: 'BTC' });
      chart.createIndicator('BTC', true, { minHeight: 100 });
    }
  }, [chart, enabled, registered, bybitData, binanceData, coinbaseData]);
};
