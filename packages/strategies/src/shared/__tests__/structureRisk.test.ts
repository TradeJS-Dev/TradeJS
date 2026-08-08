import { buildStructureRiskPlan, buildTradeEconomics } from '../structureRisk';

describe('structure risk economics', () => {
  it('treats feeRate as a decimal rate and includes both trade legs', () => {
    const economics = buildTradeEconomics({
      entryPrice: 100,
      stopLossPrice: 90,
      takeProfitPrice: 120,
      feeRate: 0.001,
    });

    expect(economics.roundTripEntryStopCostPerUnit).toBeCloseTo(0.19);
    expect(economics.roundTripEntryTargetCostPerUnit).toBeCloseTo(0.22);
    expect(economics.lossPerUnit).toBeCloseTo(10.19);
    expect(economics.rewardPerUnit).toBeCloseTo(19.78);
    expect(economics.netRiskRatio).toBeCloseTo(19.78 / 10.19);
  });

  it('sizes quantity to the net stop loss including slippage', () => {
    const plan = buildStructureRiskPlan({
      currentPrice: 100,
      direction: 'LONG',
      stopLossPrice: 90,
      targetR: 2,
      maxLossValue: 10,
      feeRate: 0.001,
      slippageBps: 10,
    });

    expect(plan.takeProfitPrice).toBe(120);
    expect(plan.grossRiskRatio).toBe(2);
    expect(plan.riskRatio).toBeLessThan(2);
    expect(plan.qty * plan.lossPerUnit).toBeCloseTo(10);
  });

  it('returns zero economics for a zero-distance stop', () => {
    const plan = buildStructureRiskPlan({
      currentPrice: 100,
      direction: 'SHORT',
      stopLossPrice: 100,
      targetR: 2,
      maxLossValue: 10,
      feeRate: 0.001,
    });

    expect(plan.grossRiskRatio).toBe(0);
    expect(plan.rewardPerUnit).toBe(0);
    expect(plan.qty).toBe(0);
  });
});
