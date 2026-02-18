import { useEffect, useMemo, useRef, useState } from 'react';
import { registerIndicator, Chart } from 'klinecharts';
import { Filters } from '@types';
import { API } from '@utils/api';

type SpreadPoint = {
  ts: string;
  spread: number | null;
};

const toSpreadInterval = (interval: string) => {
  if (interval === '15') return '15m';
  if (interval === '60') return '1h';
  return null;
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
    };

    return acc;
  }, {});
};

export const useSpreadIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const [registered, setRegistered] = useState(false);
  const [rows, setRows] = useState<SpreadPoint[]>([]);
  const spreadByTsRef = useRef<Record<number, { spread: number | null }>>({});
  const sortedSpreadRef = useRef<
    Array<{ timestamp: number; spread: number | null }>
  >([]);

  const spreadInterval = useMemo(
    () => toSpreadInterval(String(filters.interval)),
    [filters.interval],
  );

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
    const normalizedRows = rows
      .map((row) => ({
        timestamp: new Date(row.ts).getTime(),
        spread: row.spread,
      }))
      .filter((row) => Number.isFinite(row.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp);

    sortedSpreadRef.current = normalizedRows;
    spreadByTsRef.current = normalizedRows.reduce<
      Record<number, { spread: number | null }>
    >((acc, row) => {
      acc[row.timestamp] = { spread: row.spread };
      return acc;
    }, {});
  }, [rows]);

  useEffect(() => {
    if (registered) {
      return;
    }

    registerIndicator({
      name: 'SPREAD',
      shortName: 'SPREAD',
      calcParams: [],
      figures: [
        {
          key: 'SPREAD',
          title: 'Spread: ',
          type: 'line',
        },
      ],
      calc: (kLineDataList) =>
        buildSpreadValues(
          kLineDataList,
          spreadByTsRef.current,
          sortedSpreadRef.current,
        ),
    });

    setRegistered(true);
  }, [registered]);

  useEffect(() => {
    if (!registered || !chart || !enabled) {
      return;
    }

    chart.removeIndicator({ name: 'SPREAD' });
    chart.createIndicator('SPREAD', true, { minHeight: 100 });

    return () => {
      chart.removeIndicator({ name: 'SPREAD' });
    };
  }, [chart, enabled, registered]);

  useEffect(() => {
    if (!registered || !chart || !enabled) {
      return;
    }

    const updated = chart.overrideIndicator({
      name: 'SPREAD',
      calc: (kLineDataList) =>
        buildSpreadValues(
          kLineDataList,
          spreadByTsRef.current,
          sortedSpreadRef.current,
        ),
    });

    if (!updated) {
      chart.removeIndicator({ name: 'SPREAD' });
      chart.createIndicator('SPREAD', true, { minHeight: 100 });
    }
  }, [chart, enabled, registered, rows]);
};
