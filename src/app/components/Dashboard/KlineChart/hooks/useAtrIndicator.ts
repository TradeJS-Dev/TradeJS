import { ATR, SMA } from 'technicalindicators';
import { useEffect } from 'react';
import { registerIndicator, Chart } from 'klinecharts';

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
          key: `ATR_S${period}`,
          title: `ATR% S(${period}): `,
          type: 'line',
        },
        {
          key: `ATR_L${period}`,
          title: `ATR% L(${period}): `,
          type: 'line',
        },
      ]),

      calc: (kLineDataList) => {
        const closes = kLineDataList.map((x) => x.close);
        const highs = kLineDataList.map((x) => x.high);
        const lows = kLineDataList.map((x) => x.low);

        // короткое/длинное сглаживание режима
        const SMA_SHORT = 7;
        const SMA_LONG = 50;

        const seriesByPeriod = periods.map((period) => {
          // 1) ATR (укороченный массив)
          const atrRaw = ATR.calculate({
            period,
            high: highs,
            low: lows,
            close: closes,
          });
          const atrAligned: (number | undefined)[] = Array(period - 1)
            .fill(undefined)
            .concat(atrRaw);

          // 2) ATR% по каждой свече (приводим к цене)
          const atrPctAligned: (number | undefined)[] = atrAligned.map(
            (v, i) => {
              const c = closes[i];
              if (typeof v !== 'number' || !Number.isFinite(v) || !c)
                return undefined;
              return (v / c) * 100;
            },
          );

          // helper: SMA по массиву с undefined, с выравниванием длины
          const smaAligned = (values: (number | undefined)[], len: number) => {
            const numeric = values.filter(
              (x): x is number => typeof x === 'number' && Number.isFinite(x),
            );
            const sma = SMA.calculate({ period: len, values: numeric });

            // сколько undefined было до первого числа + (len-1)
            const firstNumIdx = values.findIndex(
              (x) => typeof x === 'number' && Number.isFinite(x),
            );
            const prefix =
              (firstNumIdx === -1 ? values.length : firstNumIdx) + (len - 1);

            const out: (number | undefined)[] = Array(prefix)
              .fill(undefined)
              .concat(sma);
            if (out.length > values.length) out.length = values.length;
            while (out.length < values.length) out.push(undefined);
            return out;
          };

          const shortLine = smaAligned(atrPctAligned, SMA_SHORT);
          const longLine = smaAligned(atrPctAligned, SMA_LONG);

          return { shortLine, longLine };
        });

        return kLineDataList.reduce<Record<number, Record<string, number>>>(
          (acc, { timestamp }, i) => {
            const out: Record<string, number> = {};

            periods.forEach((period, pIdx) => {
              const s = seriesByPeriod[pIdx].shortLine[i];
              const l = seriesByPeriod[pIdx].longLine[i];

              if (typeof s === 'number' && Number.isFinite(s))
                out[`ATR_S${period}`] = s;
              if (typeof l === 'number' && Number.isFinite(l))
                out[`ATR_L${period}`] = l;
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
