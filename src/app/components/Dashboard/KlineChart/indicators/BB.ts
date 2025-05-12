import { BollingerBands } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';
import { KlineChartData } from '@types';

export const BBIndicator = (
  chart: Chart,
  data: KlineChartData,
  periods: number[],
) => {
  const closes = data.map((item) => item.close);

  const values = periods.map((period) =>
    BollingerBands.calculate({
      period,
      stdDev: 3,
      values: closes,
    }),
  );

  registerIndicator({
    name: 'BB',
    shortName: 'BB',
    calcParams: periods,
    figures: [
      ...periods.map((period) => ({
        key: `BBLower${period}`,
        title: `BollingerBands Lower ${period}: `,
        type: 'line',
      })),
      ...periods.map((period) => ({
        key: `BBUpper${period}`,
        title: `BollingerBands Upper ${period}: `,
        type: 'line',
      })),
    ],

    // Calculation results
    calc: (kLineDataList) => {
      return kLineDataList.map((_, i) => {
        const bb: Record<string, number> = {};
        periods.forEach((period, j) => {
          if (i >= period - 1) {
            bb[`BBUpper${period}`] = values[j][i - (period - 1)].upper;
            bb[`BBLower${period}`] = values[j][i - (period - 1)].lower;
          }
        });

        return bb;
      });
    },
  });

  chart.createIndicator('BB', false, { id: 'candle_pane' });
};
