import { WMA } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';
import { KlineChartData } from '@types';

export const WmaIndicator = (
  chart: Chart,
  data: KlineChartData,
  periods: number[],
) => {
  const closesPrices = data.map((item) => item.close);

  const values = periods.map((period) =>
    WMA.calculate({
      period,
      values: closesPrices,
    }),
  );

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

  chart.createIndicator('WMA', true, { id: 'candle_pane' });
};
