import { useEffect } from 'react';
import { EMA } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';

export const useEmaIndicator = (
  chart: Chart | null,
  enabled: boolean,
  periods: number[],
) => {
  useEffect(() => {
    registerIndicator({
      name: 'EMA',
      shortName: 'EMA',
      calcParams: periods,
      figures: periods.map((period) => ({
        key: `EMA${period}`,
        title: `EMA${period}: `,
        type: 'line',
      })),

      // Calculation results
      calc: (kLineDataList) => {
        const closesPrices = kLineDataList.map((item) => item.close);

        const values = periods.map((period) =>
          EMA.calculate({
            period,
            values: closesPrices,
          }),
        );

        return kLineDataList.map((_, i) => {
          const ma: Record<string, number> = {};
          periods.forEach((period, j) => {
            if (i >= period - 1) {
              ma[`EMA${period}`] = values[j][i - (period - 1)];
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

    chart.createIndicator('EMA', true, { id: 'candle_pane' });

    return () => {
      chart.removeIndicator({ name: 'EMA' });
    };
  }, [chart, enabled]);
};
