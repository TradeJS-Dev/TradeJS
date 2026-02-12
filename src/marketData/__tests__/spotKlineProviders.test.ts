import { mapBinanceKline, mapCoinbaseKline } from '../spotKlineProviders';

describe('spotKlineProviders mapping', () => {
  test('mapBinanceKline maps payload to unified kline shape', () => {
    const rows = mapBinanceKline([
      [1700000000000, '100', '110', '90', '105', '12', 0, '123'],
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        timestamp: 1700000000000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 12,
        turnover: 123,
      }),
    );
  });

  test('mapCoinbaseKline maps payload to unified kline shape', () => {
    const rows = mapCoinbaseKline([[1700000000, 90, 110, 100, 105, 12]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        timestamp: 1700000000000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 12,
      }),
    );
  });
});
