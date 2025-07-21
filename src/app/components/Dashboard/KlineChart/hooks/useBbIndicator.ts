import { useEffect } from 'react';
import { BollingerBands } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';

export const useBbIndicator = (
  chart: Chart | null,
  enabled: boolean,
  periods: number[],
) => {
  useEffect(() => {
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
        const closes = kLineDataList.map((item) => item.close);

        const values = periods.map((period) =>
          BollingerBands.calculate({
            period,
            stdDev: 3,
            values: closes,
          }),
        );

        return kLineDataList.map((_, candleIndex) => {
          const bb: Record<string, number> = {};
          periods.forEach((period, periodIndex) => {
            if (candleIndex >= period - 1) {
              bb[`BBUpper${period}`] =
                values[periodIndex][candleIndex - (period - 1)].upper;
              bb[`BBLower${period}`] =
                values[periodIndex][candleIndex - (period - 1)].lower;
            }
          });

          return bb;
        });
      },
    });
  }, [periods]);

  useEffect(() => {
    if (!chart || !enabled) {
      return () => null;
    }

    chart.createIndicator('BB', false, { id: 'candle_pane' });

    return () => {
      chart.removeIndicator({ name: 'BB' });
    };
  }, [chart, enabled]);
};
