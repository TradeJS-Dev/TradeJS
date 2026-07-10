import { resolveExecutionCosts } from '../executionCosts';

describe('resolveExecutionCosts', () => {
  it('uses account fees, historical funding and instrument leverage limits', async () => {
    const connector = {
      getTradingFeeRate: jest.fn(async () => ({
        symbol: 'AAPLUSDT',
        makerRate: 0.0002,
        takerRate: 0.0005,
        source: 'exchange-account' as const,
        capturedAt: 1,
      })),
      getFundingRateHistory: jest.fn(async () => [
        { symbol: 'AAPLUSDT', timestamp: 100, rate: 0.0001 },
      ]),
    } as any;

    const { model, fundingRates } = await resolveExecutionCosts({
      connector,
      symbol: 'AAPLUSDT',
      startTime: 1,
      endTime: 200,
      config: {
        LEVERAGE: 20,
        SLIPPAGE_BASE_BPS: 2,
        SLIPPAGE_SPREAD_MULTIPLIER: 1,
        SLIPPAGE_MARKET_IMPACT_BPS: 0,
      },
      instrument: {
        provider: 'bybit',
        symbol: 'AAPLUSDT',
        kind: 'perpetual',
        universe: 'tradfi',
        assetClass: 'equity',
        status: 'trading',
        venueMetadata: { maxLeverage: 5 },
      },
    });

    expect(model.fees).toEqual({
      makerRate: 0.0002,
      takerRate: 0.0005,
      source: 'exchange-account',
    });
    expect(model.funding).toEqual(
      expect.objectContaining({
        enabled: true,
        source: 'historical',
        points: 1,
      }),
    );
    expect(model.leverage).toEqual({
      requested: 20,
      effective: 5,
      maxAllowed: 5,
    });
    expect(fundingRates).toHaveLength(1);
  });
});
