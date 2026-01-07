import { SMA, ATR } from 'technicalindicators';
import { KLineData } from 'klinecharts';
import _ from 'lodash';
import { round } from '@utils/math';

export const ATR_PCT = (
  data: KLineData[],
  period: number,
  SMA_SHORT: number,
  SMA_LONG: number,
) => {
  const closes = data.map((x) => x.close);
  const highs = data.map((x) => x.high);
  const lows = data.map((x) => x.low);

  const atrRaw = ATR.calculate({
    period,
    high: highs,
    low: lows,
    close: closes,
  });
  const atrAligned: (number | undefined)[] = Array(period - 1)
    .fill(undefined)
    .concat(atrRaw);

  const atrPctAligned: (number | undefined)[] = atrAligned.map((v, i) => {
    const c = closes[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || !c) return undefined;
    return (v / c) * 100;
  });

  const shortLine = smaAligned(atrPctAligned, SMA_SHORT);
  const longLine = smaAligned(atrPctAligned, SMA_LONG);

  const lastShortLine = shortLine[shortLine.length - 1];
  const lastLongLine = longLine[longLine.length - 1];

  const value =
    typeof lastShortLine === 'number' &&
    Number.isFinite(lastShortLine) &&
    typeof lastLongLine === 'number' &&
    Number.isFinite(lastLongLine)
      ? round(lastShortLine / lastLongLine, 2)
      : 0;

  return { shortLine, longLine, value };
};

export const smaAligned = (values: (number | undefined)[], len: number) => {
  const numeric = values.filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x),
  );
  const sma = SMA.calculate({ period: len, values: numeric });

  // сколько undefined было до первого числа + (len-1)
  const firstNumIdx = values.findIndex(
    (x) => typeof x === 'number' && Number.isFinite(x),
  );
  const prefix = (firstNumIdx === -1 ? values.length : firstNumIdx) + (len - 1);

  const out: (number | undefined)[] = Array(prefix).fill(undefined).concat(sma);
  if (out.length > values.length) out.length = values.length;
  while (out.length < values.length) out.push(undefined);
  return out;
};
