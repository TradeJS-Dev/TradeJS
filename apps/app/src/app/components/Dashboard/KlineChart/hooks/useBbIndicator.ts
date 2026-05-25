import _ from 'lodash';
import { useEffect } from 'react';
import { registerIndicator, Chart } from 'klinecharts';

const { BollingerBands } =
  require('fast-technical-indicators') as typeof import('fast-technical-indicators');

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

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, candleIndex) => {
            const bb: Record<string, number> = {};
            periods.forEach((period, periodIndex) => {
              if (candleIndex >= period - 1) {
                const value = values[periodIndex][candleIndex - (period - 1)];
                if (value.upper != null) {
                  bb[`BBUpper${period}`] = value.upper;
                }
                if (value.lower != null) {
                  bb[`BBLower${period}`] = value.lower;
                }
              }
            });

            acc[timestamp] = bb;

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

    chart.createIndicator('BB', false, { id: 'candle_pane' });

    return () => {
      chart.removeIndicator({ name: 'BB' });
    };
  }, [chart, enabled]);
};
