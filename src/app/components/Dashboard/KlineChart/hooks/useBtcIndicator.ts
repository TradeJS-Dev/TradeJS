import { useCallback, useEffect, useMemo, useRef } from 'react';
import _ from 'lodash';
import { Chart } from 'klinecharts';
import { Filters, Provider } from '@types';
import { useData } from '@store';
import { getCloseAtOrBefore } from './indicatorShared';
import { useManagedIndicator } from './useManagedIndicator';

const buildBtcValues = (
  kLineDataList: Array<{ timestamp: number }>,
  bybitByTs: Record<number, { close: number }>,
  binanceByTs: Record<number, { close: number }>,
  coinbaseByTs: Record<number, { close: number }>,
  bybitCandles: Array<{ timestamp: number; close: number }>,
  binanceCandles: Array<{ timestamp: number; close: number }>,
  coinbaseCandles: Array<{ timestamp: number; close: number }>,
) => {
  return kLineDataList.reduce<
    Record<number, Record<string, number | undefined>>
  >((acc, { timestamp }) => {
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
  }, {});
};

export const useBtcIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const indicatorId = 'btc_indicator';
  const paneId = 'btc_indicator_pane';
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

  const calc = useCallback(
    (kLineDataList: Array<{ timestamp: number }>) =>
      buildBtcValues(
        kLineDataList,
        bybitByTimestampRef.current,
        binanceByTimestampRef.current,
        coinbaseByTimestampRef.current,
        bybitCandlesRef.current,
        binanceCandlesRef.current,
        coinbaseCandlesRef.current,
      ),
    [],
  );

  const template = useMemo(
    () => ({
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
    }),
    [],
  );

  useManagedIndicator({
    chart,
    enabled,
    indicatorName: 'BTC',
    indicatorId,
    paneId,
    template,
    calc,
    updateDeps: [bybitData, binanceData, coinbaseData],
  });
};
