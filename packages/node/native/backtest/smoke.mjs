import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

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
console.log('Rust backtest addon smoke checks passed');
