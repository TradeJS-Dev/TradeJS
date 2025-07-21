import { useEffect, useMemo, useState } from 'react';
import _ from 'lodash';
import { registerIndicator, Chart } from 'klinecharts';
import { Filters } from '@types';
import { useData } from './useData';

export const useBtcIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const [registered, setRegistered] = useState(false);

  const btcFilter = useMemo(() => {
    return {
      ...filters,
      symbol: 'BTCUSDT',
    };
  }, [filters]);

  const { data, loading } = useData(btcFilter);

  useEffect(() => {
    if (loading || _.isEmpty(data)) {
      return;
    }

    registerIndicator({
      name: 'BTC',
      shortName: 'BTC',
      calcParams: ['BTC'],
      figures: [
        {
          key: `BTC`,
          title: `BTC: `,
          type: 'line',
        },
      ],

      // Calculation results
      calc: (kLineDataList) => {
        return kLineDataList.map(({ timestamp }) => {
          const value = data?.find(
            (candle) => candle.timestamp === timestamp,
          )?.close;

          return {
            BTC: value,
          };
        });
      },
    });

    setRegistered(true);
  }, [data, loading]);

  useEffect(() => {
    if (!registered || !chart || !enabled) {
      return () => null;
    }

    chart.createIndicator('BTC');

    return () => {
      chart.removeIndicator({ name: 'BTC' });
    };
  }, [chart, enabled, loading, registered]);
};
