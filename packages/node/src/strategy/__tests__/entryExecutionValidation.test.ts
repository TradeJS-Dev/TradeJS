import { buildTradeEconomics } from '@tradejs/strategy-kit/risk';
import {
  resolveEntryExecutionLimits,
  validateEntryExecution,
} from '../entryExecutionValidation';

describe('final entry economics', () => {
  const limits = {
    minimumNetRiskRatio: 1.55,
    maxLossValue: 1,
    feeRate: 0.001,
    slippageBps: 0,
  };
  it.each([
    ['NMR', 9.763, 9.222, 10.584900000000005, 1.9],
    ['W', 0.011264, 0.010544, 0.0123766, 1412.8],
    ['ANKR', 0.003913, 0.003695, 0.0042542000000000005, 4616],
    ['TNSR', 0.0277, 0.02625, 0.029984000000000004, 692.5],
  ])(
    'flags low RR for the recorded November 4 %s ask',
    (_symbol, price, stop, target, qty) => {
      expect(
        validateEntryExecution({
          direction: 'LONG',
          price,
          qty,
          stopLossPrice: stop,
          takeProfitPrice: target,
          limits,
        }),
      ).toMatchObject({ belowMinimumNetRiskRatio: true });
    },
  );
  it('reports risk above the budget without blocking an otherwise valid entry', () => {
    expect(
      validateEntryExecution({
        direction: 'LONG',
        price: 100,
        qty: 1,
        stopLossPrice: 95,
        takeProfitPrice: 120,
        limits,
      }),
    ).toMatchObject({
      riskExceeded: true,
      belowMinimumNetRiskRatio: false,
      plannedLossValue: expect.closeTo(5.195, 12),
    });
  });
  it.each(['LONG', 'SHORT'] as const)(
    'includes fees and reserved slippage for %s',
    (direction) => {
      const price = 100,
        stop = direction === 'LONG' ? 95 : 105,
        target = direction === 'LONG' ? 120 : 80;
      const economics = buildTradeEconomics({
        entryPrice: price,
        stopLossPrice: stop,
        takeProfitPrice: target,
        feeRate: 0.001,
        slippageBps: 7,
      });
      const result = validateEntryExecution({
        direction,
        price,
        qty: 0.1,
        stopLossPrice: stop,
        takeProfitPrice: target,
        limits: { ...limits, slippageBps: 7 },
      });
      expect(result.netRiskRatio).toBeCloseTo(economics.netRiskRatio, 12);
      expect(result.plannedLossValue).toBeCloseTo(
        economics.lossPerUnit * 0.1,
        12,
      );
    },
  );
  it('uses the requested direction config and preserves a zero threshold', () => {
    expect(
      resolveEntryExecutionLimits(
        {
          MAX_LOSS_VALUE: 1,
          RISK_FEE_RATE: 0.001,
          LONG: { minRiskRatio: 0 },
          SHORT: { minRiskRatio: 2 },
        },
        'LONG',
      ),
    ).toEqual({ ...limits, minimumNetRiskRatio: 0 });
  });
  it('does not invent a budget or RR threshold for configs without them', () => {
    expect(resolveEntryExecutionLimits({}, 'LONG')).toBeUndefined();
  });
  it.each([NaN, Infinity, -1])('rejects invalid cost input %s', (feeRate) => {
    expect(() =>
      resolveEntryExecutionLimits(
        { MAX_LOSS_VALUE: 1, RISK_FEE_RATE: feeRate },
        'LONG',
      ),
    ).toThrow('INVALID_ENTRY_EXECUTION_LIMITS');
  });
});
