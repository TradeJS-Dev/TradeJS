import {
  assertStrategyExecutionIsolation,
  executionCostsFromModel,
  parseBacktestExecutionCosts,
} from '../../backtest';

const costs = {
  fees: { makerRate: 0, takerRate: 0.001 },
  slippage: {
    baseBps: 10,
    spreadMultiplier: 0,
    marketImpactBps: 0,
    delayRiskMultiplier: 0,
  },
  funding: { enabled: false },
};

describe('backtest execution cost contract', () => {
  it('preserves zero and maker rebates and returns an independent snapshot', () => {
    const parsed = parseBacktestExecutionCosts(costs);
    expect(parsed).toEqual(costs);
    expect(parsed.fees).not.toBe(costs.fees);
    expect(
      parseBacktestExecutionCosts({
        ...costs,
        fees: { makerRate: -0.0001, takerRate: 0 },
      }).fees.makerRate,
    ).toBe(-0.0001);
  });
  it.each([
    null,
    {},
    { ...costs, fees: { makerRate: null, takerRate: 0 } },
    { ...costs, slippage: { ...costs.slippage, baseBps: -1 } },
    { ...costs, slippage: { ...costs.slippage, baseBps: 10000 } },
    { ...costs, slippage: { ...costs.slippage, spreadMultiplier: NaN } },
    { ...costs, funding: { enabled: 'false' } },
    { ...costs, slippage: { ...costs.slippage, basBps: 10 } },
  ])(
    'rejects incomplete, ambiguous or invalid execution settings %#',
    (value) => {
      expect(() => parseBacktestExecutionCosts(value)).toThrow();
    },
  );
  it('strips observational metadata for stable economic identity', () => {
    const model = {
      ...costs,
      fees: { ...costs.fees, source: 'config' },
      slippage: { ...costs.slippage, source: 'config' },
      funding: { enabled: false, source: 'disabled' },
      capturedAt: 1,
    } as any;
    expect(executionCostsFromModel(model)).toEqual(costs);
    expect(executionCostsFromModel({ ...model, capturedAt: 999 })).toEqual(
      costs,
    );
  });
  it('allows decision assumptions but rejects legacy execution fields even when null', () => {
    expect(() =>
      assertStrategyExecutionIsolation({
        RISK_FEE_RATE: 0.001,
        RISK_SLIPPAGE_BPS: 10,
      }),
    ).not.toThrow();
    expect(() =>
      assertStrategyExecutionIsolation({ SLIPPAGE_BASE_BPS: null }),
    ).toThrow('SLIPPAGE_BASE_BPS');
  });
});
