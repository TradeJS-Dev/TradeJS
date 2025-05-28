import { generateParamGrid } from '../grid';

describe('generateParamGrid', () => {
  it('returns correct number of combinations for 2 parameters', () => {
    const grid = generateParamGrid({
      param1: [1, 2],
      param2: ['a', 'b', 'c'],
    });

    expect(grid.length).toBe(2 * 3); // 6 combinations

    // Проверка что каждая комбинация уникальна
    const seen = new Set(grid.map(g => JSON.stringify(g)));
    expect(seen.size).toBe(6);
  });

  it('returns correct combinations for single parameter', () => {
    const grid = generateParamGrid({
      only: [10, 20, 30],
    });

    expect(grid).toEqual([{ only: 10 }, { only: 20 }, { only: 30 }]);
  });

  it('returns one empty object when no params are provided', () => {
    const grid = generateParamGrid({});
    expect(grid).toEqual([{}]);
  });

  it('handles nested values (e.g. arrays of objects)', () => {
    const grid = generateParamGrid({
      TP: [
        [{ profit: 0.1, rate: 0.5 }],
        [{ profit: 0.2, rate: 0.5 }],
      ],
      SL: [0.05, 0.1],
    });

    expect(grid.length).toBe(2 * 2); // 4 combinations
    expect(grid).toContainEqual({
      TP: [{ profit: 0.1, rate: 0.5 }],
      SL: 0.05,
    });
  });

  it('returns correct number of combinations for full param set (real example)', () => {
    const paramGrid = generateParamGrid({
      MA_FAST: [12, 14, 16], // 3
      MA_SLOW: [60, 70, 80, 90], // 4
      ATR_PERIOD: [14, 16], // 2
      ATR_OPEN: [0.6], // 1
      ATR_CLOSE: [1.2, 1.3], // 2
      BB_PERIOD: [13, 14, 15], // 3
      BB_STDDEV: [2], // 1
      OBV_SMA_PERIOD: [60, 65, 70], // 3
      BREAKOUT_LOOKBACK: [20, 25, 30, 35], // 4
      SL_LONG: [0.06, 0.07, 0.08, 0.09], // 4
      SL_SHORT: [0.06, 0.07, 0.08, 0.09], // 4
      TP_LONG: [
        [
          { profit: 0.2, rate: 0.5 },
          { profit: 0.4, rate: 0.5 },
        ],
      ], // 1
      TP_SHORT: [
        [
          { profit: 0.03, rate: 0.25 },
          { profit: 0.07, rate: 0.25 },
          { profit: 0.1, rate: 0.25 },
          { profit: 0.15, rate: 0.25 },
        ],
        [
          { profit: 0.02, rate: 0.25 },
          { profit: 0.05, rate: 0.25 },
          { profit: 0.1, rate: 0.25 },
          { profit: 0.2, rate: 0.25 },
        ],
      ], // 2
    });

    // Умножаем количество вариантов для каждого параметра
    const expectedCount =
      3 * 4 * 2 * 1 * 2 * 3 * 1 * 3 * 4 * 4 * 4 * 1 * 2;

    expect(paramGrid.length).toBe(expectedCount);
  });
});
