import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSymbolMix } from './symbol-mix-diagnostics.mjs';
const r = (symbol, timestamp, profit, direction = 'SHORT') => ({
  symbol,
  timestamp,
  profit,
  direction,
});
test('symbol panel separates newly observed symbols and reconciles mean attribution', () => {
  const d = compareSymbolMix(
    [r('A', 1, 2), r('B', 2, -2)],
    [r('A', 3, 1), r('A', 4, 1), r('B', 5, -3), r('C', 5, -10)],
  );
  assert.equal(d.symbols, 2);
  assert.equal(d.after.trades, 3);
  assert.equal(d.laterAbsentBefore.trades, 1);
  assert.equal(d.after.events, 3);
  assert.ok(
    Math.abs(d.meanChange - d.mixEffect - d.withinSymbolEffect) < 1e-12,
  );
});
test('support panel uses counts only, preserves direction zeros and rejects invalid traces', () => {
  const d = compareSymbolMix([r('A', 1, 2)], [r('A', 2, -3)], 5);
  assert.equal(d.symbols, 0);
  assert.equal(d.afterDirections.LONG.trades, 0);
  assert.equal(d.meanChange, null);
  assert.throws(() => compareSymbolMix([r('A', 1, NaN)], []), /Invalid/);
});
