import { useEffect, useMemo, useState } from 'react';
import _ from 'lodash';
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

export const useSpreadIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const [registered, setRegistered] = useState(false);
  const [rows, setRows] = useState<SpreadPoint[]>([]);
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
    if (_.isEmpty(rows)) return;

    registerIndicator({
      name: 'SPREAD',
      shortName: 'SPREAD',
      calcParams: ['SPREAD'],
      figures: [
        {
          key: 'SPREAD',
          title: 'Spread: ',
          type: 'line',
        },
      ],
      calc: (kLineDataList) => {
        const spreadByTs = _.keyBy(
          rows.map((row) => ({
            ts: new Date(row.ts).getTime(),
            spread: row.spread,
          })),
          'ts',
        );
        return kLineDataList.reduce<Record<number, Record<string, number | undefined>>>(
          (acc, { timestamp }) => {
            const value = spreadByTs[timestamp]?.spread;
            acc[timestamp] = {
              SPREAD: Number.isFinite(Number(value)) ? Number(value) : undefined,
            };
            return acc;
          },
          {},
        );
      },
    });

    setRegistered(true);
  }, [rows]);

  useEffect(() => {
    if (!registered || !chart || !enabled) return;

    chart.createIndicator('SPREAD', true, { minHeight: 100 });

    return () => {
      chart.removeIndicator({ name: 'SPREAD' });
    };
  }, [chart, enabled, registered]);
};
