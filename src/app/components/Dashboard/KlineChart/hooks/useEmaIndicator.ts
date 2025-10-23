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

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, candleIndex) => {
            const ema: Record<string, number> = {};
            periods.forEach((period, j) => {
              if (candleIndex >= period - 1) {
                ema[`EMA${period}`] = values[j][candleIndex - (period - 1)];
              }
            });

            acc[timestamp] = ema;

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

    chart.createIndicator('EMA', true, { id: 'candle_pane' });

    return () => {
      chart.removeIndicator({ name: 'EMA' });
    };
  }, [chart, enabled]);
};
