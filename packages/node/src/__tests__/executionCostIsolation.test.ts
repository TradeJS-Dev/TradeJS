import { resolveExecutionCosts } from '../executionCosts';

describe('execution cost configuration', () => {
  it('resolves execution settings independently of strategy risk assumptions', async () => {
    const { model } = await resolveExecutionCosts({
      connector: {} as any,
      symbol: 'BTCUSDT',
      startTime: 1,
      endTime: 2,
      config: { RISK_FEE_RATE: 0.005, RISK_SLIPPAGE_BPS: 50 },
      executionCosts: {
        fees: { makerRate: 0, takerRate: 0.001 },
        slippage: {
          baseBps: 10,
          spreadMultiplier: 0,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
        },
        funding: { enabled: false },
      },
      cacheOnly: true,
    });
    expect(model.fees).toEqual({
      makerRate: 0,
      takerRate: 0.001,
      source: 'config',
    });
    expect(model.slippage.baseBps).toBe(10);
    expect(model.funding).toMatchObject({ enabled: false, source: 'disabled' });
  });

  it('rejects ambiguous flat execution fields before running a test', async () => {
    await expect(
      resolveExecutionCosts({
        connector: {} as any,
        symbol: 'BTCUSDT',
        startTime: 1,
        endTime: 2,
        config: { SLIPPAGE_BASE_BPS: 10 },
      }),
    ).rejects.toThrow('SLIPPAGE_BASE_BPS');
  });
});
