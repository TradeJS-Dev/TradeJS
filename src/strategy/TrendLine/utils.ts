import { SMA } from 'technicalindicators';
import { KlineChartData, TrendLineMode } from '@types';

export const getSma = (period: number, data: KlineChartData) => {
  const values = new SMA({
    period,
    values: data.map((candle) => candle.close),
  }).getResult() as number[];

  const last = values[values.length - 1];

  return { values, last };
};

export const makeRelPrice = (price: number, percent: number) =>
  (price * (100 + percent)) / 100;

export const countSupportCandles = (
  mode: TrendLineMode,
  values: KlineChartData,
  max: number,
  min: number,
) => {
  if (!values || values.length < 2) {
    return 0;
  }

  if (mode === 'highs') {
    return values.filter(
      ({ low, high }, i) =>
        i < values.length - 1 && high < max && high > min && low < min,
    ).length;
  }

  if (mode === 'lows') {
    return values.filter(
      ({ high, low }, i) =>
        i < values.length - 1 && low > max && low < min && high > min,
    ).length;
  }

  return 0;
};
