import { useEffect } from 'react';
import { registerIndicator, Chart } from 'klinecharts';

const { WMA } =
  require('fast-technical-indicators') as typeof import('fast-technical-indicators');

export const useWmaIndicator = (
  chart: Chart | null,
  enabled: boolean,
  periods: number[],
) => {
  useEffect(() => {
    registerIndicator({
      name: 'WMA',
      shortName: 'WMA',
      calcParams: periods,
      figures: periods.map((period) => ({
        key: `WMA${period}`,
        title: `WMA${period}: `,
        type: 'line',
      })),

      // Calculation results
      calc: (kLineDataList) => {
        const closesPrices = kLineDataList.map((item) => item.close);

        const values = periods.map((period) =>
          WMA.calculate({
            period,
            values: closesPrices,
          }),
        );

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, candleIndex) => {
            const ma: Record<string, number> = {};
            periods.forEach((period, j) => {
              if (candleIndex >= period - 1) {
                ma[`WMA${period}`] = values[j][candleIndex - (period - 1)];
              }
            });

            acc[timestamp] = ma;

            return acc;
          },
          {},
        );
      },
    });
  }, [periods]);

  useEffect(() => {
    if (!chart || !enabled) {
      return () => null;
    }

    chart.createIndicator('WMA', true, { id: 'candle_pane' });

    return () => {
      chart.removeIndicator({ name: 'WMA' });
    };
  }, [chart, enabled]);
};
