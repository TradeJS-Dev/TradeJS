import { ATR } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';
import { KlineChartData } from '@types';

export const AtrIndicator = (
  chart: Chart,
  data: KlineChartData,
  periods: number[],
) => {
  const highs = data.map((item) => item.high);
  const lows = data.map((item) => item.low);
  const closes = data.map((item) => item.close);

  const values = periods.map((period) =>
    ATR.calculate({
      period,
      high: highs,
      low: lows,
      close: closes,
    }),
  );

  registerIndicator({
    name: 'ATR',
    shortName: 'ATR',
    calcParams: periods,
    figures: [
      ...periods.map((period) => ({
      key: `ATR${period}`,
      title: `ATR ${period}: `,
      type: 'line',
    })),
    ...periods.map((period) => ({
      key: `ATROpen${period}`,
      title: `ATR Open ${period}: `,
      type: 'line',
    })),
    ...periods.map((period) => ({
      key: `ATRClose${period}`,
      title: `ATR Close ${period}: `,
      type: 'line',
    })),
    ...periods.map((period) => ({
      key: `Volotile${period}`,
      title: `Volotile ${period}: `,
      type: 'line',
    })),
  ],

    // Calculation results
    calc: (kLineDataList) => {
      return kLineDataList.map((_, i) => {
        const atr: Record<string, number> = {};
        periods.forEach((period, j) => {
          if (i >= period - 1) {
            atr[`ATR${period}`] = values[j][i - (period - 1)];
            atr[`ATROpen${period}`] = values[j][i - (period - 1)]*0.5;
            atr[`ATRClose${period}`] = values[j][i - (period - 1)]*1.5;
            atr[`Volotile${period}`] = closes[i] - closes[i -1];
          }
        });

        return atr;
      });
    },
  });

  chart.createIndicator('ATR', false, { id: 'atr', height: 500});
};
