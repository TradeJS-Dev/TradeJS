import {
  alignSortedCandlesByTimestamp,
  buildReturnsFromCandles,
  calculateCoinBtcCorrelation,
  calculatePearsonCorrelation,
} from '@utils/correlation';
import { KlineChartItem } from '@tradejs/types';

const makeCandle = (timestamp: number, close: number): KlineChartItem => ({
  timestamp,
  dt: new Date(timestamp).toISOString(),
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
  turnover: close,
});

describe('correlation utils', () => {
  it('aligns sorted candle arrays by timestamp intersection', () => {
    const coin = [makeCandle(1, 100), makeCandle(2, 101), makeCandle(4, 103)];
    const btc = [makeCandle(2, 200), makeCandle(3, 201), makeCandle(4, 202)];

    const { alignedCoinCandles, alignedBtcCandles } =
      alignSortedCandlesByTimestamp(coin, btc);

    expect(alignedCoinCandles.map((c) => c.timestamp)).toEqual([2, 4]);
    expect(alignedBtcCandles.map((c) => c.timestamp)).toEqual([2, 4]);
  });

  it('builds returns and skips candles with non-finite closes', () => {
    const candles = [
      makeCandle(1, 100),
      makeCandle(2, 105),
      makeCandle(3, Number.NaN),
      makeCandle(4, 110),
      makeCandle(5, 121),
    ];

    const returns = buildReturnsFromCandles(candles);

    expect(returns).toEqual([0.05, 0.1]);
  });

  it('handles pearson edge-cases and perfect correlations', () => {
    expect(() => calculatePearsonCorrelation([1, 2], [1])).toThrow(
      'series lengths are different',
    );
    expect(calculatePearsonCorrelation([], [])).toBeNull();
    expect(calculatePearsonCorrelation([1], [1])).toBeNull();
    expect(calculatePearsonCorrelation([1, 1, 1], [2, 3, 4])).toBeNull();
    expect(calculatePearsonCorrelation([1, 2, 3], [2, 4, 6])).toBe(1);
    expect(calculatePearsonCorrelation([1, 2, 3], [3, 2, 1])).toBe(-1);
  });

  it('returns null correlation when aligned sample is too short', () => {
    const coin = Array.from({ length: 10 }, (_, i) =>
      makeCandle(i + 1, 100 + i),
    );
    const btc = Array.from({ length: 10 }, (_, i) =>
      makeCandle(i + 1, 200 + i),
    );

    const result = calculateCoinBtcCorrelation(coin, btc);

    expect(result.correlation).toBeNull();
    expect(result.coinReturns).toEqual([]);
    expect(result.btcReturns).toEqual([]);
  });

  it('calculates rounded coin/btc correlation and sliced return series', () => {
    const closes = [100, 101, 103, 102, 105, 107, 106, 108, 111, 110, 112, 115];
    const coin = closes.map((close, index) => makeCandle(index + 1, close));
    const btc = closes.map((close, index) => makeCandle(index + 1, close * 2));

    const result = calculateCoinBtcCorrelation(coin, btc);

    expect(result.alignedCoinCandles).toHaveLength(12);
    expect(result.alignedBtcCandles).toHaveLength(12);
    expect(result.coinReturns).toHaveLength(11);
    expect(result.btcReturns).toHaveLength(11);
    expect(result.correlation).toBe(1);
  });
});
