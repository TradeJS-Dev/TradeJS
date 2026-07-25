/** @jest-environment node */

import {
  buildGridClassicGridPlan,
  calculateGridClassicPositionLoss,
} from '../guardrails';

const buildPlan = (direction: 'LONG' | 'SHORT', takeProfitMode = 'center') =>
  buildGridClassicGridPlan({
    direction,
    entryPrice: direction === 'LONG' ? 96 : 104,
    lowerPrice: 95,
    upperPrice: 105,
    atr: 1,
    levels: 4,
    stepAtr: 0.7,
    stepRangeFraction: 0.1,
    levelSizeDecay: 1,
    stopAtrBuffer: 0.5,
    takeProfitMode: takeProfitMode as 'center' | 'opposite_edge',
    maxLossValue: 10,
    feeRate: 0.001,
    slippageRate: 0.001,
  })!;

describe('GridClassic risk guardrails', () => {
  it.each(['LONG', 'SHORT'] as const)(
    'keeps the full %s grid within MAX_LOSS_VALUE without martingale',
    (direction) => {
      const plan = buildPlan(direction);
      const quantities = plan.levels.map((level) => level.qty);
      const notionals = plan.levels.map((level) => level.qty * level.price);
      const perLevelRisk = plan.levels.map((level) => level.worstCaseLoss);

      expect(plan.worstCaseLoss).toBeLessThanOrEqual(10 + 1e-10);
      quantities.slice(1).forEach((qty, index) => {
        expect(qty).toBeLessThanOrEqual(quantities[index] + 1e-12);
        expect(notionals[index + 1]).toBeLessThanOrEqual(
          notionals[index] + 1e-10,
        );
        expect(perLevelRisk[index + 1]).toBeLessThanOrEqual(
          perLevelRisk[index] + 1e-10,
        );
      });
    },
  );

  it('prices center and opposite-edge take-profit modes', () => {
    expect(buildPlan('LONG', 'center').takeProfitPrice).toBe(100);
    expect(buildPlan('LONG', 'opposite_edge').takeProfitPrice).toBe(105);
    expect(buildPlan('SHORT', 'center').takeProfitPrice).toBe(100);
    expect(buildPlan('SHORT', 'opposite_edge').takeProfitPrice).toBe(95);
  });

  it('includes fees and slippage in aggregate position risk', () => {
    const gross = calculateGridClassicPositionLoss({
      qty: 1,
      averagePrice: 100,
      stopLossPrice: 95,
      feeRate: 0,
      slippageRate: 0,
    });
    const net = calculateGridClassicPositionLoss({
      qty: 1,
      averagePrice: 100,
      stopLossPrice: 95,
      feeRate: 0.001,
      slippageRate: 0.001,
    });

    expect(gross).toBe(5);
    expect(net).toBeGreaterThan(gross);
  });
});
