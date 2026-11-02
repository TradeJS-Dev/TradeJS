import { toMlCandle, toSharedReferenceCandle } from '../indicatorMath';
import type { Candle } from '@tradejs/types';
const candle = (): Candle => ({
  timestamp: 1000,
  open: 1.1,
  high: 2,
  low: 1,
  close: 1.5,
  volume: 3,
  turnover: 4,
});
test('shares only immutable normalized reference snapshots', () => {
  const source = candle();
  const a = toSharedReferenceCandle(source),
    b = toSharedReferenceCandle(source);
  expect(a).toEqual(toMlCandle(source));
  expect(a).toBe(b);
  expect(a).not.toBe(source);
  expect(Object.isFrozen(a)).toBe(true);
  source.close = 7;
  const changed = toSharedReferenceCandle(source);
  expect(changed).not.toBe(a);
  expect(changed).toEqual(toMlCandle(source));
  expect(a.close).toBe(1.5);
});
test('preserves normalization of non-finite values and does not alter source records', () => {
  const source = { ...candle(), volume: NaN, turnover: -0 };
  expect(toSharedReferenceCandle(source)).toEqual(toMlCandle(source));
  expect(Number.isNaN(source.volume)).toBe(true);
  expect(Object.is(source.turnover, -0)).toBe(true);
});
