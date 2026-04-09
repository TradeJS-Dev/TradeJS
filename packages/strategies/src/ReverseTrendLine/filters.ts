import { diffRel } from '@tradejs/core/math';
import { KlineChartData } from '@tradejs/types';

const MAX_CANDLE_VOLATILITY = 0.025;

export const filterByVeryVolatility = (data: KlineChartData) => {
  const lastCandle = data[data.length - 1];
  const prevCandle = data[data.length - 2];

  if (!lastCandle || !prevCandle) {
    return false;
  }

  const isVeryVolatility =
    diffRel(lastCandle.low, lastCandle.high) > MAX_CANDLE_VOLATILITY ||
    diffRel(prevCandle.low, prevCandle.high) > MAX_CANDLE_VOLATILITY;

  return !isVeryVolatility;
};
