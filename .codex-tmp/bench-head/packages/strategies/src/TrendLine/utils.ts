import { SMA } from 'technicalindicators';

import { KlineChartData, TrendLineMode } from '@tradejs/types';

export const getSma = (period: number, data: KlineChartData) => {
  const currentPeriod = Math.min(period, data.length - 1);

  const values = new SMA({
    period: currentPeriod,
    values: data.map((candle) => candle.close),
  }).getResult() as number[];

  const last = values[values.length - 1];

  return { values, last };
};

export const makeRelPrice = (price: number, percent: number) =>
  (price * (100 + percent)) / 100;

export const getSupportLevels = (
  mode: TrendLineMode,
  values: KlineChartData,
  max: number,
  min: number,
) => {
  if (!values || values.length < 2) {
    return [];
  }

  if (mode === 'highs') {
    return values
      .filter(
        ({ low, high }, i) =>
          i < values.length - 1 && high < max && high > min && low < min,
      )
      .map((x) => x.high);
  }

  if (mode === 'lows') {
    return values
      .filter(
        ({ high, low }, i) =>
          i < values.length - 1 && low > max && low < min && high > min,
      )
      .map((x) => x.low);
  }

  return [];
};
