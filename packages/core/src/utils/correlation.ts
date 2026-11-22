import { round } from './math';
import type { Candle } from '@tradejs/types';

/**
 * Выравнивает два отсортированных массива свечей по timestamp.
 * Оставляет только те свечи, которые есть в обоих массивах.
 */
export const alignSortedCandlesByTimestamp = <
  Coin extends Candle,
  Btc extends Candle,
>(
  coinCandles: Coin[],
  btcCandles: Btc[],
): {
  alignedCoinCandles: Coin[];
  alignedBtcCandles: Btc[];
} => {
  const alignedCoinCandles: Coin[] = [];
  const alignedBtcCandles: Btc[] = [];

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
export const buildReturnsFromCandles = (
  candles: readonly Candle[],
): number[] => {
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

const MIN_CANDLES_FOR_CORRELATION = 10;

export type IndicatorCorrelation = (
  coinWindow: Candle[],
  btcWindow: Candle[],
) => number;

export const calculateWindowCorrelation: IndicatorCorrelation = (coin, btc) =>
  calculateCoinBtcCorrelation(coin, btc).correlation ?? 0;

/** Computes the same rounded value for aligned windows without copying or joining candles. */
export const createIndicatorCorrelation = (): IndicatorCorrelation => {
  const coinReturns: number[] = [];
  const btcReturns: number[] = [];
  return (coin, btc) => {
    const length = coin.length;
    if (Math.min(length, btc.length) <= MIN_CANDLES_FOR_CORRELATION) return 0;
    if (length !== btc.length) return calculateWindowCorrelation(coin, btc);

    let previousCoin = coin[0].close;
    let previousBtc = btc[0].close;
    if (
      coin[0].timestamp !== btc[0].timestamp ||
      !Number.isFinite(previousCoin) ||
      !Number.isFinite(previousBtc)
    ) {
      return calculateWindowCorrelation(coin, btc);
    }

    coinReturns.length = length - 1;
    btcReturns.length = length - 1;
    for (let index = 1; index < length; index += 1) {
      const left = coin[index];
      const right = btc[index];
      if (
        left.timestamp !== right.timestamp ||
        !Number.isFinite(left.close) ||
        !Number.isFinite(right.close)
      ) {
        return calculateWindowCorrelation(coin, btc);
      }
      coinReturns[index - 1] = (left.close - previousCoin) / previousCoin;
      btcReturns[index - 1] = (right.close - previousBtc) / previousBtc;
      previousCoin = left.close;
      previousBtc = right.close;
    }
    const correlation = calculatePearsonCorrelation(coinReturns, btcReturns);
    return correlation ? round(correlation) : correlation ?? 0;
  };
};

/**
 * Полный пайплайн:
 * 1) выравниваем свечи монеты и BTC по timestamp
 * 2) считаем доходности
 * 3) считаем корреляцию доходностей
 */
export const calculateCoinBtcCorrelation = <
  Coin extends Candle,
  Btc extends Candle,
>(
  coinCandles: Coin[],
  btcCandles: Btc[],
): {
  correlation: number | null;
  alignedCoinCandles: Coin[];
  alignedBtcCandles: Btc[];
  coinReturns: number[];
  btcReturns: number[];
} => {
  const { alignedCoinCandles, alignedBtcCandles } =
    alignSortedCandlesByTimestamp(coinCandles, btcCandles);

  // минимальная длина для более-менее осмысленной корреляции
  if (alignedCoinCandles.length <= MIN_CANDLES_FOR_CORRELATION) {
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
