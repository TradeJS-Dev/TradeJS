import { ATR } from 'technicalindicators';
import { useEffect } from 'react';
import { registerIndicator, Chart } from 'klinecharts';
import { ATR_PCT } from '@src/indicators';

export const useAtrIndicator = (
  chart: Chart | null,
  enabled: boolean,
  periods: number[],
) => {
  useEffect(() => {
    registerIndicator({
      name: 'ATR_PCT',
      shortName: 'ATR%',
      calcParams: periods,

      figures: periods.flatMap((period) => [
        {
          key: `ATR_SL${period}`,
          title: `ATR% SL(${period}): `,
          type: 'line',
        },
      ]),

      calc: (kLineDataList) => {
        const SMA_SHORT = 7;
        const SMA_LONG = 50;

        const seriesByPeriod = periods.map((period) => {
          const { shortLine, longLine } = ATR_PCT(
            kLineDataList,
            period,
            SMA_SHORT,
            SMA_LONG,
          );

          return { shortLine, longLine };
        });

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, i) => {
            const out: Record<string, number> = {};

            periods.forEach((period, pIdx) => {
              const s = seriesByPeriod[pIdx].shortLine[i];
              const l = seriesByPeriod[pIdx].longLine[i];

              if (
                typeof s === 'number' &&
                Number.isFinite(s) &&
                typeof l === 'number' &&
                Number.isFinite(l)
              ) {
                out[`ATR_SL${period}`] = s / l;
              }
            });

            acc[timestamp] = out;
            return acc;
          },
          {},
        );
      },
    });
  }, [periods]);

  useEffect(() => {
    if (!chart || !enabled) return;

    chart.createIndicator('ATR_PCT', true, { id: 'atr_pct', minHeight: 80 });

    return () => {
      chart.removeIndicator({ id: 'atr_pct' });
    };
  }, [chart, enabled]);
};
