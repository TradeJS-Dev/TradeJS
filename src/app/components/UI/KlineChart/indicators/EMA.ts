import { EMA } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';
import { KlineChartData } from '@types';

export const EmaIndicator = (
  chart: Chart,
  data: KlineChartData,
  periods: number[],
) => {
  const closesPrices = data.map((item) => item.close);

  const values = periods.map((period) =>
    EMA.calculate({
      period,
      values: closesPrices,
    }),
  );

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

  chart.createIndicator('EMA', true, { id: 'candle_pane' });
};
