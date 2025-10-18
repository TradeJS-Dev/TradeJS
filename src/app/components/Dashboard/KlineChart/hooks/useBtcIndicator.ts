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

  const { data, fulfilled } = useData(btcFilter);

  useEffect(() => {
    if (!fulfilled || _.isEmpty(data)) {
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
  }, [data, fulfilled]);

  useEffect(() => {
    if (!registered || !chart || !enabled || !fulfilled) {
      return;
    }

    chart.createIndicator('BTC');

    return () => {
      chart.removeIndicator({ name: 'BTC' });
    };
  }, [chart, enabled, fulfilled, registered]);
};
