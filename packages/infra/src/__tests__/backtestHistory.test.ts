import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiskBacktestHistory } from '../backtestHistory';

it('preserves cold indexed reads, slices and historical candle fields', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tradejs-history-test-'));
  const storage = createDiskBacktestHistory(directory);
  try {
    const numbers = storage.numbers();
    const reference = Array.from({ length: 1_400 }, (_, index) =>
      index === 5 ? NaN : index === 7 ? -0 : index,
    );
    numbers.push(...reference);
    expect(readdirSync(directory)).toHaveLength(1);
    expect(numbers.at(-1)).toBe(1399);
    expect(numbers.slice(245, 269)).toEqual(reference.slice(245, 269));
    expect(numbers.slice(-8, 10)).toEqual([]);
    expect(numbers.map((value) => value)).toEqual(reference);
    expect(Object.keys(numbers)).toEqual(Object.keys(reference));

    const candle = {
      timestamp: 1,
      open: 10,
      high: 12,
      low: 8,
      close: 9,
      volume: 3,
      turnover: 28,
      takerBuyBaseVolume: null,
      dt: 'first',
    };
    const candles = storage.candles([candle]);
    candles.at(-1)!.close = 11;
    for (let i = 0; i < 800; i++) {
      candles.push({ ...candle, timestamp: i + 2 });
    }
    expect(candles[0]).toEqual({ ...candle, close: 11 });
    expect(candles.length).toBe(801);
    candles.length = 0;
    candles.push({ ...candle, timestamp: 2 });
    expect(candles.slice()).toEqual([{ ...candle, timestamp: 2 }]);
    storage.close();
    storage.close();
    expect(readdirSync(directory)).toEqual([]);
    expect(() => numbers[0]).toThrow('Backtest history storage is closed');
  } finally {
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
