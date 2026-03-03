import {
  cloneArrayValues,
  intervalToMs,
  isWrongData,
  mergeData,
} from '@utils/array';
import { Interval, KlineChartItem } from '@types';

const createCandle = (timestamp: number, close: number): KlineChartItem => ({
  timestamp,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  turnover: 1,
  dt: new Date(timestamp).toISOString(),
});

describe('array utils', () => {
  describe('intervalToMs', () => {
    it('converts minute and day/week/month intervals to milliseconds', () => {
      expect(intervalToMs('1')).toBe(60_000);
      expect(intervalToMs('15')).toBe(900_000);
      expect(intervalToMs('D')).toBe(86_400_000);
      expect(intervalToMs('W')).toBe(604_800_000);
      expect(intervalToMs('M')).toBe(2_592_000_000);
    });

    it('throws for unknown interval', () => {
      expect(() => intervalToMs('2' as Interval)).toThrow(
        'Unknown interval: 2',
      );
    });
  });

  describe('mergeData', () => {
    it('merges arrays by timestamp and keeps values from the second array on conflicts', () => {
      const base = [createCandle(1_000, 100), createCandle(2_000, 200)];
      const incoming = [createCandle(2_000, 201), createCandle(3_000, 300)];

      expect(mergeData(base, incoming)).toEqual([
        createCandle(1_000, 100),
        createCandle(2_000, 201),
        createCandle(3_000, 300),
      ]);
    });
  });

  describe('isWrongData', () => {
    it('returns false for empty or single-item arrays', () => {
      expect(isWrongData('1', [])).toBe(false);
      expect(isWrongData('1', [createCandle(1_000, 100)])).toBe(false);
    });

    it('returns false when all candles match interval step', () => {
      const data = [
        createCandle(0, 100),
        createCandle(60_000, 101),
        createCandle(120_000, 102),
      ];

      expect(isWrongData('1', data)).toBe(false);
    });

    it('returns true when there is a gap that does not match interval step', () => {
      const data = [
        createCandle(0, 100),
        createCandle(60_000, 101),
        createCandle(190_000, 102),
      ];

      expect(isWrongData('1', data)).toBe(true);
    });
  });

  describe('cloneArrayValues', () => {
    it('clones array values and keeps scalar values as-is', () => {
      const src = {
        arr: [1, 2],
        value: 7,
      };

      const cloned = cloneArrayValues(src);

      expect(cloned).toEqual(src);
      expect(cloned.arr).not.toBe(src.arr);
      expect(cloned.value).toBe(src.value);
    });
  });
});
