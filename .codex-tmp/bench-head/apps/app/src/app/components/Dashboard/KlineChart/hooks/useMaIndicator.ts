import { useEffect } from 'react';
import { SMA } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';

export const useMaIndicator = (
  chart: Chart | null,
  enabled: boolean,
  periods: number[],
) => {
  useEffect(() => {
    registerIndicator({
      name: 'MA',
      shortName: 'MA',
      calcParams: periods,
      figures: periods.map((period) => ({
        key: `MA${period}`,
        title: `MA${period}: `,
        type: 'line',
      })),

      // Calculation results
      calc: (kLineDataList) => {
        const closesPrices = kLineDataList.map((item) => item.close);

        const values = periods.map((period) =>
          SMA.calculate({
            period,
            values: closesPrices,
          }),
        );

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, candleIndex) => {
            const ma: Record<string, number> = {};
            periods.forEach((period, j) => {
              if (candleIndex >= period - 1) {
                ma[`MA${period}`] = values[j][candleIndex - (period - 1)];
              }
            }, {});

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

    chart.createIndicator('MA', true, { id: 'candle_pane' });

    return () => {
      chart.removeIndicator({ name: 'MA' });
    };
  }, [chart, enabled]);
};
