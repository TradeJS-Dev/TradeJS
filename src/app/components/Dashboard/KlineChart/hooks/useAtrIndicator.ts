import { useEffect } from 'react';
import { ATR } from 'technicalindicators';
import { registerIndicator, Chart } from 'klinecharts';

export const useAtrIndicator = (
  chart: Chart | null,
  enabled: boolean,
  periods: number[],
) => {
  useEffect(() => {
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
        let closes = [] as number[];
        let highs = [] as number[];
        let lows = [] as number[];

        kLineDataList.forEach((item) => {
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

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, candleIndex) => {
            const atr: Record<string, number> = {};
            periods.forEach((period, periodIndex) => {
              if (candleIndex >= period - 1) {
                const atrValue =
                  values[periodIndex][candleIndex - (period - 1)];
                const atrThreshold = atrValue * 0.5;

                atr[`Volotile${period}`] =
                  Math.abs(
                    closes[closes.length - 1] - closes[closes.length - 2],
                  ) > atrThreshold
                    ? 1
                    : 0;
              }
            });

            acc[timestamp] = atr;

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

    chart.createIndicator('ATR', false, { id: 'atr' });

    return () => {
      chart.removeIndicator({ name: 'ATR' });
    };
  }, [enabled]);
};
