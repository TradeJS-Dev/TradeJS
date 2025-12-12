import { SMA } from 'technicalindicators';
import { Trend, KlineChartData } from '@types';

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

export const hasSupportLevel = (
  trend: Trend,
  values: KlineChartData,
  max: number,
  min: number,
) => {
  if (!values || values.length < 2) {
    return;
  }

  if (trend === 'BULL') {
    return values.some(
      ({ low, high }, i) => i < values.length - 1 && high < max && low < min,
    );
  }

  if (trend === 'BEAR') {
    return values.some(
      ({ high, low }, i) => i < values.length - 1 && low < max && high < min,
    );
  }

  return false;
};
