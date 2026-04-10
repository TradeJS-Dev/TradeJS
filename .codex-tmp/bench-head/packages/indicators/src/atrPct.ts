import { ATR } from 'technicalindicators';
import { KLineData } from 'klinecharts';
import { smaAligned } from './smaAligned';

const round = (value: number, precision = 2): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

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
