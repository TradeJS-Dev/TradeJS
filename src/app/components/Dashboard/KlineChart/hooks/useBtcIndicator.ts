import { useEffect, useState } from 'react';
import _ from 'lodash';
import { registerIndicator, Chart } from 'klinecharts';
import { Filters } from '@types';
import { useData } from '@store';

export const useBtcIndicator = (
  chart: Chart | null,
  enabled: boolean,
  filters: Filters,
) => {
  const [registered, setRegistered] = useState(false);

  const btcFilter = {
    ...filters,
    symbol: 'BTCUSDT',
  };

  const { data } = useData(btcFilter);

  useEffect(() => {
    if (_.isEmpty(data)) {
      return;
    }

    registerIndicator({
      name: 'BTC',
      shortName: 'BTC',
      calcParams: ['BTC'],
      figures: [
        {
          key: `BTC`,
          title: `BTC value: `,
          type: 'line',
        },
      ],

      // Calculation results
      calc: (kLineDataList) => {
        return kLineDataList.reduce<
          Record<number, Record<string, number | undefined>>
        >((acc, { timestamp }) => {
          const value = data?.find(
            (candle) => candle.timestamp === timestamp,
          )?.close;

          acc[timestamp] = {
            BTC: value,
          };

          return acc;
        }, {});
      },
    });

    setRegistered(true);
  }, [data]);

  useEffect(() => {
    if (!registered || !chart || !enabled) {
      return;
    }

    chart.createIndicator('BTC', true, { minHeight: 100 });

    return () => {
      chart.removeIndicator({ name: 'BTC' });
    };
  }, [chart, enabled, registered]);
};
