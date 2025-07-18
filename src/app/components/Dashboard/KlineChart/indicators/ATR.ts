import { ATR } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';
import { KlineChartData } from '@types';

export const AtrIndicator = (
  chart: Chart,
  data: KlineChartData,
  periods: number[],
) => {
  let closes = [] as number[];
  let highs = [] as number[];
  let lows = [] as number[];

  data.forEach((item) => {
    closes.push(item.close);
    highs.push(item.high);
    lows.push(item.low);
  });

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
        key: `Volotile${period}`,
        title: `Volotile ${period}: `,
        type: 'line',
      })),
    ],

    // Calculation results
    calc: (kLineDataList) => {
      return kLineDataList.map((_, candleIndex) => {
        const atr: Record<string, number> = {};
        periods.forEach((period, periodIndex) => {
          if (candleIndex >= period - 1) {
            const atrValue = values[periodIndex][candleIndex - (period - 1)];
            const atrThreshold = atrValue * 0.5;

            atr[`Volotile${period}`] =
              Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) >
              atrThreshold
                ? 1
                : 0;
          }
        });

        return atr;
      });
    },
  });

  chart.createIndicator('ATR', false, { id: 'atr' });
};
