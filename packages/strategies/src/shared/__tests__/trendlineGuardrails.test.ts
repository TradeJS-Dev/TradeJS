import {
  buildTrendLineEvaluator,
  getBias,
  getLastFiniteNumber,
  getSortedTrendLinePoints,
  getSpreadPct,
  getTrendLineFromPayload,
  toFiniteNumberOrNull,
} from '../trendlineGuardrails';
import { clampNumber, normalizePositiveNumber } from '../risk';

describe('shared trendline guardrail helpers', () => {
  it('normalizes finite numbers and tails', () => {
    expect(toFiniteNumberOrNull('1.5')).toBe(1.5);
    expect(toFiniteNumberOrNull('nope')).toBeNull();
    expect(getLastFiniteNumber([1, '2', null])).toBe(0);
    expect(getLastFiniteNumber([])).toBeNull();
  });

  it('derives bias and spread', () => {
    expect(getBias(2, 1)).toBe('bullish');
    expect(getBias(1, 2)).toBe('bearish');
    expect(getBias(1, 1)).toBe('flat');
    expect(getSpreadPct(110, 100)).toBe(10);
    expect(getSpreadPct(110, 0)).toBeNull();
  });

  it('resolves and evaluates sorted trendline points', () => {
    const trendLine = {
      points: [
        { timestamp: 3, value: 130 },
        { timestamp: 1, value: 110 },
        { timestamp: 'bad', value: 120 },
      ],
    };

    expect(getTrendLineFromPayload({ figures: { trendLine } })).toBe(trendLine);
    expect(getSortedTrendLinePoints(trendLine)).toEqual([
      { timestamp: 1, value: 110 },
      { timestamp: 3, value: 130 },
    ]);
    expect(buildTrendLineEvaluator(trendLine)?.evaluate(2)).toBe(120);
  });

  it('normalizes risk numbers', () => {
    expect(clampNumber(5, 1, 3)).toBe(3);
    expect(normalizePositiveNumber(-1, 2)).toBe(2);
    expect(normalizePositiveNumber(1.5, 2)).toBe(1.5);
  });
});
