import { SPREAD_WINDOW } from '@constants';

type SpreadValue = number | null | undefined;

type SpreadPointInput = {
  timestamp: number;
  spread?: SpreadValue;
  binancePrice?: SpreadValue;
  coinbasePrice?: SpreadValue;
};

const toFiniteNumber = (value: SpreadValue): number | null => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toFiniteSpread = (value: SpreadValue): number | null => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const createSpreadSmoother = (window = SPREAD_WINDOW) => {
  const binanceWindow: number[] = [];
  const coinbaseWindow: number[] = [];
  let binanceSum = 0;
  let coinbaseSum = 0;

  const next = (params: {
    binancePrice?: SpreadValue;
    coinbasePrice?: SpreadValue;
    fallbackSpread?: SpreadValue;
  }): number | null => {
    const binance = toFiniteNumber(params.binancePrice);
    const coinbase = toFiniteNumber(params.coinbasePrice);

    if (binance != null && coinbase != null) {
      binanceWindow.push(binance);
      coinbaseWindow.push(coinbase);
      binanceSum += binance;
      coinbaseSum += coinbase;

      if (binanceWindow.length > window) {
        binanceSum -= binanceWindow.shift() ?? 0;
        coinbaseSum -= coinbaseWindow.shift() ?? 0;
      }
    }

    let spread = toFiniteSpread(params.fallbackSpread);
    if (binanceWindow.length > 0 && coinbaseWindow.length > 0) {
      const avgBinance = binanceSum / binanceWindow.length;
      const avgCoinbase = coinbaseSum / coinbaseWindow.length;
      if (Number.isFinite(avgBinance) && avgBinance > 0) {
        spread = (avgCoinbase - avgBinance) / avgBinance;
      }
    }

    return toFiniteSpread(spread);
  };

  return { next };
};

export const smoothSpreadSeries = (
  points: SpreadPointInput[],
  window = SPREAD_WINDOW,
): Array<{ timestamp: number; spread: number | null }> => {
  const smoother = createSpreadSmoother(window);
  return points.map((point) => ({
    timestamp: point.timestamp,
    spread: smoother.next({
      binancePrice: point.binancePrice,
      coinbasePrice: point.coinbasePrice,
      fallbackSpread: point.spread,
    }),
  }));
};
