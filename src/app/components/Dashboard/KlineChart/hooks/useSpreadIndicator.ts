import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import _ from 'lodash';
import { Chart } from 'klinecharts';
import { Filters, Interval, Provider } from '@types';
import { API } from '@utils/api';
import { useData } from '@store';
import { grayDashedLineStyle } from './indicatorShared';
import { useManagedIndicator } from './useManagedIndicator';

const WINDOW = 50;

type SpreadPoint = {
  ts: string | number | Date;
  spread: number | null;
  binance_price?: number | null;
  coinbase_price?: number | null;
  binancePrice?: number | null;
  coinbasePrice?: number | null;
};

const toSpreadInterval = (interval: string) => {
  if (interval === '15') return '15m';
  if (interval === '60' || interval === '240' || interval === '720')
    return '1h';
  return null;
};

const toDataInterval = (interval: string): Interval | null => {
  if (interval === '15') return '15' as Interval;
  if (interval === '60' || interval === '240' || interval === '720') {
    return '60' as Interval;
  }
  return null;
};

const toTimestampMs = (value: SpreadPoint['ts']) => {
  if (typeof value === 'number') {
    return value < 1e12 ? value * 1000 : value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const getSpreadAtOrBefore = (
  points: Array<{ timestamp: number; spread: number | null }>,
  timestamp: number,
) => {
  let left = 0;
  let right = points.length - 1;
  let result: number | null | undefined;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const point = points[mid];

    if (point.timestamp <= timestamp) {
      result = point.spread;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return result;
};

const buildSpreadValues = (
  kLineDataList: Array<{ timestamp: number }>,
  spreadByTs: Record<number, { spread: number | null }>,
  sortedSpread: Array<{ timestamp: number; spread: number | null }>,
) => {
  return kLineDataList.reduce<
    Record<number, Record<string, number | undefined>>
  >((acc, { timestamp }) => {
    const value =
      spreadByTs[timestamp]?.spread ??
      getSpreadAtOrBefore(sortedSpread, timestamp);

    acc[timestamp] = {
      SPREAD: Number.isFinite(Number(value)) ? Number(value) : undefined,
      SPREAD_ZERO: 0,
    };

    return acc;
  }, {});
};

const getBinancePrice = (row: SpreadPoint) =>
  row.binancePrice ?? row.binance_price ?? null;

const getCoinbasePrice = (row: SpreadPoint) =>
  row.coinbasePrice ?? row.coinbase_price ?? null;

export const useSpreadIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const indicatorId = 'spread_indicator';
  const paneId = 'spread_indicator_pane';
  const [rows, setRows] = useState<SpreadPoint[]>([]);
  const spreadByTsRef = useRef<Record<number, { spread: number | null }>>({});
  const sortedSpreadRef = useRef<
    Array<{ timestamp: number; spread: number | null }>
  >([]);

  const spreadInterval = useMemo(
    () => toSpreadInterval(String(filters.interval)),
    [filters.interval],
  );
  const dataInterval = useMemo(
    () => toDataInterval(String(filters.interval)),
    [filters.interval],
  );

  const fallbackFilters = useMemo(
    () => ({
      ...filters,
      interval: dataInterval ?? filters.interval,
      symbol: filters.symbol.toUpperCase(),
    }),
    [filters, dataInterval],
  );

  const { data: binanceData } = useData({
    ...fallbackFilters,
    provider: 'binance' as Provider,
  });
  const { data: coinbaseData } = useData({
    ...fallbackFilters,
    provider: 'coinbase' as Provider,
  });

  const fallbackRows = useMemo(() => {
    if (!dataInterval) return [] as SpreadPoint[];

    const coinbaseByTs = _.keyBy(coinbaseData, 'timestamp');
    const result: SpreadPoint[] = [];

    for (const binanceCandle of binanceData) {
      const coinbaseCandle = coinbaseByTs[binanceCandle.timestamp];
      if (!coinbaseCandle || binanceCandle.close <= 0) continue;

      result.push({
        ts: binanceCandle.timestamp,
        spread:
          (coinbaseCandle.close - binanceCandle.close) / binanceCandle.close,
        binancePrice: binanceCandle.close,
        coinbasePrice: coinbaseCandle.close,
      });
    }

    return result;
  }, [dataInterval, binanceData, coinbaseData]);

  useEffect(() => {
    if (!spreadInterval || !filters.symbol) {
      setRows([]);
      return;
    }

    API.get<{ rows?: SpreadPoint[] }>(
      `/api/spread/${filters.symbol}/${spreadInterval}?from=${filters.start}&to=${filters.end}`,
    )
      .then((res) => {
        setRows(res.rows ?? []);
      })
      .catch(() => setRows([]));
  }, [filters.symbol, filters.start, filters.end, spreadInterval]);

  useEffect(() => {
    const sourceRows = rows.length ? rows : fallbackRows;
    const normalizedRows = sourceRows
      .map((row) => ({
        timestamp: toTimestampMs(row.ts),
        spread: row.spread,
        binancePrice: getBinancePrice(row),
        coinbasePrice: getCoinbasePrice(row),
      }))
      .filter((row) => Number.isFinite(row.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);

    const smoothedRows: Array<{ timestamp: number; spread: number | null }> =
      [];
    const binanceWindow: number[] = [];
    const coinbaseWindow: number[] = [];
    let binanceSum = 0;
    let coinbaseSum = 0;

    for (const row of normalizedRows) {
      if (
        Number.isFinite(row.binancePrice) &&
        Number.isFinite(row.coinbasePrice)
      ) {
        const binance = Number(row.binancePrice);
        const coinbase = Number(row.coinbasePrice);
        binanceWindow.push(binance);
        coinbaseWindow.push(coinbase);
        binanceSum += binance;
        coinbaseSum += coinbase;

        if (binanceWindow.length > WINDOW) {
          binanceSum -= binanceWindow.shift() ?? 0;
          coinbaseSum -= coinbaseWindow.shift() ?? 0;
        }
      }

      let spread = row.spread;
      if (binanceWindow.length > 0 && coinbaseWindow.length > 0) {
        const avgBinance = binanceSum / binanceWindow.length;
        const avgCoinbase = coinbaseSum / coinbaseWindow.length;
        if (
          Number.isFinite(avgBinance) &&
          avgBinance > 0 &&
          Number.isFinite(avgCoinbase)
        ) {
          spread = (avgCoinbase - avgBinance) / avgBinance;
        }
      }

      smoothedRows.push({
        timestamp: row.timestamp,
        spread: Number.isFinite(Number(spread)) ? Number(spread) : null,
      });
    }

    sortedSpreadRef.current = smoothedRows;
    spreadByTsRef.current = smoothedRows.reduce<
      Record<number, { spread: number | null }>
    >((acc, row) => {
      acc[row.timestamp] = { spread: row.spread };
      return acc;
    }, {});
  }, [rows, fallbackRows]);

  const calc = useCallback(
    (kLineDataList: Array<{ timestamp: number }>) =>
      buildSpreadValues(
        kLineDataList,
        spreadByTsRef.current,
        sortedSpreadRef.current,
      ),
    [],
  );

  const template = useMemo(
    () => ({
      shortName: 'SPREAD',
      calcParams: [],
      figures: [
        {
          key: 'SPREAD',
          title: 'Spread: ',
          type: 'line',
        },
        {
          key: 'SPREAD_ZERO',
          title: 'Zero: ',
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
    indicatorName: 'SPREAD',
    indicatorId,
    paneId,
    template,
    calc,
    updateDeps: [rows, fallbackRows],
  });
};
