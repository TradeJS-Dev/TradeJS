import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { calculateCoinBtcCorrelation } from '@tradejs/core/indicators';
import { round } from '@tradejs/core/math';

const addon = createRequire(import.meta.url)(resolve(process.argv[2]));
const match = (long, high, low, stop, targets) => [
  ...addon.matchExits(long, high, low, stop, Float64Array.from(targets)),
];

assert.deepEqual(match(true, 120, 90, 90, [115, 120]), [-1]);
assert.deepEqual(match(false, 120, 90, 120, [100, 90]), [-1]);
assert.deepEqual(match(true, 120, 90, 0, [125, 120, 115]), [1, 2]);
assert.deepEqual(match(false, 120, 90, 0, [85, 100, 90]), [1, 2]);
assert.deepEqual(match(false, 120, 90, 0, [89]), []);
assert.deepEqual(match(true, 120, 90, NaN, []), []);

const fee = 110.25 * 0.003 * 0.001;
assert.deepEqual(
  [...addon.netProfit(14.5, 110.25, 0.003, 0.001)],
  [fee, 14.5 - fee],
);
assert.deepEqual(
  [
    ...addon.alignTimestamps(
      Float64Array.of(1, 2, 2, 6),
      Float64Array.of(2, 2, 3, 6),
    ),
  ],
  [1, 0, 2, 1, 3, 3],
);
const window = 50;
const actualPrices = Float64Array.from({ length: 300 }, (_, i) =>
  i < 20 ? 100 : 100 + Math.sin(i) + i / 7,
);
const refPrices = Float64Array.from({ length: 300 }, (_, i) =>
  i < 20 ? 200 : 200 - 5 * Math.sin(i) + i / 2,
);
const correlation = addon.rollingCorrelation(actualPrices, refPrices, window);
const candles = (prices) =>
  Array.from(prices, (close, timestamp) => ({ timestamp, close }));
const coinCandles = candles(actualPrices);
const btcCandles = candles(refPrices);
assert.equal(correlation.length, actualPrices.length);
for (let i = 0; i < correlation.length; i += 1) {
  const start = Math.max(0, i - window + 1);
  const expected =
    calculateCoinBtcCorrelation(
      coinCandles.slice(start, i + 1),
      btcCandles.slice(start, i + 1),
    ).correlation ?? 0;
  assert.equal(
    correlation[i] ? round(correlation[i]) : correlation[i],
    expected,
  );
}
assert.deepEqual(
  addon.rollingCorrelation(
    actualPrices.subarray(0, 123),
    refPrices.subarray(0, 123),
    window,
  ),
  correlation.slice(0, 123),
);
assert.throws(() =>
  addon.rollingCorrelation(actualPrices, refPrices.subarray(1), window),
);
console.log('Rust backtest addon smoke checks passed');
