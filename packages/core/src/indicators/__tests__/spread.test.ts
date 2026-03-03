import { createSpreadSmoother, smoothSpreadSeries } from '../spread';

describe('spread indicator helpers', () => {
  it('calculates rolling spread from binance/coinbase prices', () => {
    const smoother = createSpreadSmoother(2);
    expect(
      smoother.next({ binancePrice: 100, coinbasePrice: 101 }),
    ).toBeCloseTo(0.01);
    expect(
      smoother.next({ binancePrice: 200, coinbasePrice: 202 }),
    ).toBeCloseTo(0.01);
    expect(
      smoother.next({ binancePrice: 200, coinbasePrice: 198 }),
    ).toBeCloseTo(0);
  });

  it('uses fallback spread when price pair is missing', () => {
    const smoother = createSpreadSmoother(2);
    expect(smoother.next({ fallbackSpread: 0.02 })).toBeCloseTo(0.02);
    expect(smoother.next({ fallbackSpread: null })).toBeNull();
  });

  it('smooths series preserving timestamps', () => {
    const rows = smoothSpreadSeries([
      { timestamp: 1, binancePrice: 100, coinbasePrice: 101 },
      { timestamp: 2, spread: 0.015 },
      { timestamp: 3, binancePrice: 200, coinbasePrice: 202 },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ timestamp: 1, spread: 0.01 });
    expect(rows[1]).toEqual({ timestamp: 2, spread: 0.01 });
    expect(rows[2]).toEqual({ timestamp: 3, spread: 0.01 });
  });
});
