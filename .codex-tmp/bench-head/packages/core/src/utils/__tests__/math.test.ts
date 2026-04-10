import {
  absReturns,
  diffRel,
  equityPoints,
  formatNumber,
  mean,
  relReturns,
  round,
  sum,
} from '@utils/math';
import { PositionLogData } from '@tradejs/types';

describe('math utils', () => {
  describe('diffRel', () => {
    it('returns relative difference normalized to the larger value', () => {
      expect(diffRel(5, 10)).toBe(0.5);
      expect(diffRel(10, 5)).toBe(0.5);
    });

    it('returns 0 when any value is zero to avoid division by zero', () => {
      expect(diffRel(0, 10)).toBe(0);
      expect(diffRel(0, 0)).toBe(0);
    });
  });

  describe('round', () => {
    it('rounds to two decimals by default', () => {
      expect(round(1.2345)).toBe(1.23);
    });

    it('obeys provided precision and handles negative precision as zero', () => {
      expect(round(1.9876, 3)).toBe(1.988);
      expect(round(1.9, 0)).toBe(2);
      expect(round(1.9, -1)).toBe(2);
    });
  });

  describe('sum and mean', () => {
    const numbers = [1, 2, 3, 4, 5];

    it('computes sum correctly', () => {
      expect(sum(numbers)).toBe(15);
    });

    it('computes mean correctly and returns 0 for empty array', () => {
      expect(mean(numbers)).toBe(3);
      expect(mean([])).toBe(0);
    });
  });

  const samplePositionLogData: PositionLogData = [
    {
      direction: 'LONG',
      open: { amount: 100, timestamp: 1000 },
      close: { amount: 120, timestamp: 2000 },
    },
    {
      direction: 'SHORT',
      open: { amount: 90, timestamp: 1500 },
      close: { amount: 80, timestamp: 2500 },
    },
  ];

  describe('position-based utilities', () => {
    it('calculates absolute returns for each trade', () => {
      expect(absReturns(samplePositionLogData)).toEqual([20, -10]);
    });

    it('calculates relative returns for each trade', () => {
      const results = relReturns(samplePositionLogData);
      expect(results[0]).toBeCloseTo(0.2);
      expect(results[1]).toBeCloseTo(-0.1111111111111111);
    });

    it('orders equity points chronologically', () => {
      expect(equityPoints(samplePositionLogData)).toEqual([
        { ts: 1000, amount: 100 },
        { ts: 1500, amount: 90 },
        { ts: 2000, amount: 120 },
        { ts: 2500, amount: 80 },
      ]);
    });
  });

  describe('formatNumber', () => {
    it('formats finite numbers with default digits', () => {
      expect(formatNumber(123.456789)).toBe('123.456789');
      expect(formatNumber(-1.23456, 3)).toBe('-1.235');
    });

    it('drops fractional digits when number magnitude is >= 1000', () => {
      expect(formatNumber(1234.5678)).toBe('1235');
    });

    it('returns null for invalid or undefined inputs', () => {
      expect(formatNumber(null)).toBeNull();
      expect(formatNumber(undefined)).toBeNull();
      expect(formatNumber(Infinity)).toBeNull();
    });
  });
});
