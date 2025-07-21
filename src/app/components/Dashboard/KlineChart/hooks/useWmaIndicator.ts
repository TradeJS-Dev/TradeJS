import { useEffect } from 'react';
import { WMA } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';

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

        return kLineDataList.map((_, i) => {
          const ma: Record<string, number> = {};
          periods.forEach((period, j) => {
            if (i >= period - 1) {
              ma[`WMA${period}`] = values[j][i - (period - 1)];
            }
          });

          return ma;
        });
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
