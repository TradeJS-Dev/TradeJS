import { round } from '@utils/math';
import { Candle } from '@types';

/**
 * Выравнивает два отсортированных массива свечей по timestamp.
 * Оставляет только те свечи, которые есть в обоих массивах.
 */
export const alignSortedCandlesByTimestamp = (
  coinCandles: Candle[],
  btcCandles: Candle[],
): { alignedCoinCandles: Candle[]; alignedBtcCandles: Candle[] } => {
  const alignedCoinCandles: Candle[] = [];
  const alignedBtcCandles: Candle[] = [];

  let coinIndex = 0;
  let btcIndex = 0;

  while (coinIndex < coinCandles.length && btcIndex < btcCandles.length) {
    const coinTimestampMs = coinCandles[coinIndex].timestamp;
    const btcTimestampMs = btcCandles[btcIndex].timestamp;

    if (coinTimestampMs === btcTimestampMs) {
      alignedCoinCandles.push(coinCandles[coinIndex]);
      alignedBtcCandles.push(btcCandles[btcIndex]);
      coinIndex += 1;
      btcIndex += 1;
    } else if (coinTimestampMs < btcTimestampMs) {
      // свеча есть только в монете → пропускаем
      coinIndex += 1;
    } else {
      // свеча есть только в BTC → пропускаем
      btcIndex += 1;
    }
  }

  return {
    alignedCoinCandles,
    alignedBtcCandles,
  };
};

/** Строим массив доходностей по close: (close[i] - close[i-1]) / close[i-1] */
export const buildReturnsFromCandles = (candles: Candle[]): number[] => {
  const returns: number[] = [];

  for (let candleIndex = 1; candleIndex < candles.length; candleIndex += 1) {
    const previousClose = candles[candleIndex - 1].close;
    const currentClose = candles[candleIndex].close;

    if (!Number.isFinite(previousClose) || !Number.isFinite(currentClose)) {
      continue;
    }

    const change = (currentClose - previousClose) / previousClose;
    returns.push(change);
  }

  return returns;
};

/** Корреляция Пирсона между двумя числовыми рядами одинаковой длины */
export const calculatePearsonCorrelation = (
  firstSeries: number[],
  secondSeries: number[],
): number | null => {
  if (firstSeries.length !== secondSeries.length) {
    throw new Error(
      'calculatePearsonCorrelation: series lengths are different',
    );
  }

  const length = firstSeries.length;
  if (length === 0) return null;
  if (length === 1) return null; // одного значения мало для корреляции

  const sumFirst = firstSeries.reduce((sum, value) => sum + value, 0);
  const sumSecond = secondSeries.reduce((sum, value) => sum + value, 0);

  const meanFirst = sumFirst / length;
  const meanSecond = sumSecond / length;

  let covariance = 0;
  let varianceFirst = 0;
  let varianceSecond = 0;

  for (let index = 0; index < length; index += 1) {
    const deltaFirst = firstSeries[index] - meanFirst;
    const deltaSecond = secondSeries[index] - meanSecond;

    covariance += deltaFirst * deltaSecond;
    varianceFirst += deltaFirst * deltaFirst;
    varianceSecond += deltaSecond * deltaSecond;
  }

  if (varianceFirst === 0 || varianceSecond === 0) {
    return null; // один из рядов константный → корреляция не определена
  }

  const correlation = covariance / Math.sqrt(varianceFirst * varianceSecond);
  return correlation;
};

/**
 * Полный пайплайн:
 * 1) выравниваем свечи монеты и BTC по timestamp
 * 2) считаем доходности
 * 3) считаем корреляцию доходностей
 */
export const calculateCoinBtcCorrelation = (
  coinCandles: Candle[],
  btcCandles: Candle[],
): {
  correlation: number | null;
  alignedCoinCandles: Candle[];
  alignedBtcCandles: Candle[];
  coinReturns: number[];
  btcReturns: number[];
} => {
  const { alignedCoinCandles, alignedBtcCandles } =
    alignSortedCandlesByTimestamp(coinCandles, btcCandles);

  // минимальная длина для более-менее осмысленной корреляции
  const MIN_LENGTH_FOR_CORRELATION = 10;
  if (alignedCoinCandles.length <= MIN_LENGTH_FOR_CORRELATION) {
    return {
      correlation: null,
      alignedCoinCandles,
      alignedBtcCandles,
      coinReturns: [],
      btcReturns: [],
    };
  }

  const coinReturns = buildReturnsFromCandles(alignedCoinCandles);
  const btcReturns = buildReturnsFromCandles(alignedBtcCandles);

  const minReturnsLength = Math.min(coinReturns.length, btcReturns.length);
  const slicedCoinReturns = coinReturns.slice(-minReturnsLength);
  const slicedBtcReturns = btcReturns.slice(-minReturnsLength);

  const correlation = calculatePearsonCorrelation(
    slicedCoinReturns,
    slicedBtcReturns,
  );

  return {
    correlation: correlation ? round(correlation) : correlation,
    alignedCoinCandles,
    alignedBtcCandles,
    coinReturns: slicedCoinReturns,
    btcReturns: slicedBtcReturns,
  };
};
