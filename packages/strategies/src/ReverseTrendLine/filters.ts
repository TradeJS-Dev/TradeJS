import { diffRel } from '@tradejs/core/math';
import { Candle, KlineChartData } from '@tradejs/types';

const MAX_CANDLE_VOLATILITY = 0.025;

type VolatilityCandle = Pick<Candle, 'high' | 'low'>;

export const filterByVeryVolatilityCandles = (
  lastCandle: VolatilityCandle | null | undefined,
  prevCandle: VolatilityCandle | null | undefined,
) => {
  if (!lastCandle || !prevCandle) {
    return false;
  }

  const isVeryVolatility =
    diffRel(lastCandle.low, lastCandle.high) > MAX_CANDLE_VOLATILITY ||
    diffRel(prevCandle.low, prevCandle.high) > MAX_CANDLE_VOLATILITY;

  return !isVeryVolatility;
};

export const filterByVeryVolatility = (data: KlineChartData) =>
  filterByVeryVolatilityCandles(data[data.length - 1], data[data.length - 2]);
