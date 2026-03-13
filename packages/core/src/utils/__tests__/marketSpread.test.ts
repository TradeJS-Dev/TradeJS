import {
  alignSpreadRows,
  coinbaseProductFromSymbol,
  rollingMeanStd,
  intervalToMs,
} from '../spread';

describe('marketSpread utils', () => {
  test('intervalToMs maps supported intervals', () => {
    expect(intervalToMs('15m')).toBe(900_000);
    expect(intervalToMs('1h')).toBe(3_600_000);
  });

  test('coinbaseProductFromSymbol normalizes known quote suffixes', () => {
    expect(coinbaseProductFromSymbol('BTCUSDT')).toBe('BTC-USD');
    expect(coinbaseProductFromSymbol('ethusdc')).toBe('ETH-USD');
    expect(coinbaseProductFromSymbol('SOLUSD')).toBe('SOL-USD');
    expect(coinbaseProductFromSymbol('USDT')).toBeNull();
    expect(coinbaseProductFromSymbol('ABC')).toBeNull();
  });

  test('alignSpreadRows joins by ts and calculates spread', () => {
    const rows = alignSpreadRows({
      symbol: 'BTCUSDT',
      interval: '15m',
      source: 'binance_coinbase_spread',
      binance: [
        { ts: 1_000, close: 100 },
        { ts: 2_000, close: 200 },
      ],
      coinbase: [
        { ts: 1_000, close: 101 },
        { ts: 2_000, close: 198 },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0].spread).toBeCloseTo(0.01);
    expect(rows[1].spread).toBeCloseTo(-0.01);
  });

  test('alignSpreadRows skips invalid rows and unmatched timestamps', () => {
    const rows = alignSpreadRows({
      symbol: 'BTCUSDT',
      interval: '15m',
      source: 'binance_coinbase_spread',
      binance: [
        { ts: Number.NaN, close: 100 },
        { ts: 1_000, close: 0 },
        { ts: 2_000, close: -1 },
        { ts: 3_000, close: 300 },
        { ts: 4_000, close: 400 },
      ],
      coinbase: [
        { ts: 3_000, close: Number.NaN },
        { ts: 4_000, close: 420 },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].ts.getTime()).toBe(4_000);
    expect(rows[0].spread).toBeCloseTo(0.05);
  });

  test('rollingMeanStd returns stable values for window', () => {
    const values = [1, 2, 3, 4, 5];
    const result = rollingMeanStd(values, 4, 3);
    expect(result.mean).toBeCloseTo(4);
    expect(result.std).toBeCloseTo(Math.sqrt(2 / 3));
  });

  test('rollingMeanStd handles empty and single-point windows', () => {
    expect(rollingMeanStd([Number.NaN], 0, 1)).toEqual({ mean: 0, std: 0 });
    expect(rollingMeanStd([10], 0, 3)).toEqual({ mean: 10, std: 0 });
  });
});
