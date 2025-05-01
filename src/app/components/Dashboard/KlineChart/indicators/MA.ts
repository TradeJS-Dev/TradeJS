import { SMA } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';
import { KlineChartData } from '@types';

export const MaIndicator = (
  chart: Chart,
  data: KlineChartData,
  periods: number[],
) => {
  const closesPrices = data.map((item) => item.close);

  const values = periods.map((period) =>
    SMA.calculate({
      period,
      values: closesPrices,
    }),
  );

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
      return kLineDataList.map((_, i) => {
        const ma: Record<string, number> = {};
        periods.forEach((period, j) => {
          if (i >= period - 1) {
            ma[`MA${period}`] = values[j][i - (period - 1)];
          }
        });

        return ma;
      });
    },
  });

  chart.createIndicator('MA', true, { id: 'candle_pane' });
};
