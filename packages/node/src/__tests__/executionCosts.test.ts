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

  it('uses configured costs without calling exchange APIs in cache-only mode', async () => {
    const connector = {
      getTradingFeeRate: jest.fn(),
      getFundingRateHistory: jest.fn(),
    } as any;

    const { model, fundingRates } = await resolveExecutionCosts({
      connector,
      symbol: 'AAPLUSDT',
      startTime: 1,
      endTime: 200,
      config: { LEVERAGE: 4 },
      cacheOnly: true,
      executionCosts: {
        fees: { makerRate: 0.001, takerRate: 0.002 },
        slippage: {
          baseBps: 3,
          spreadMultiplier: 2,
          marketImpactBps: 1,
          delayRiskMultiplier: 0.5,
        },
        funding: { enabled: false },
      },
    });

    expect(connector.getTradingFeeRate).not.toHaveBeenCalled();
    expect(connector.getFundingRateHistory).not.toHaveBeenCalled();
    expect(fundingRates).toEqual([]);
    expect(model).toEqual(
      expect.objectContaining({
        fees: {
          makerRate: 0.001,
          takerRate: 0.002,
          source: 'config',
        },
        funding: expect.objectContaining({
          enabled: false,
          source: 'disabled',
          points: 0,
        }),
        slippage: {
          baseBps: 3,
          spreadMultiplier: 2,
          marketImpactBps: 1,
          delayRiskMultiplier: 0.5,
          source: 'config',
        },
        leverage: { requested: 4, effective: 4, maxAllowed: null },
        quality: 'partial',
      }),
    );
  });

  it('falls back safely when exchange fee and funding requests fail', async () => {
    const connector = {
      getTradingFeeRate: jest.fn(async () => {
        throw new Error('fee unavailable');
      }),
      getFundingRateHistory: jest.fn(async () => {
        throw new Error('funding unavailable');
      }),
    } as any;

    const { model, fundingRates } = await resolveExecutionCosts({
      connector,
      symbol: 'BTCUSDT',
      startTime: 1,
      endTime: 200,
      config: {},
    });

    expect(fundingRates).toEqual([]);
    expect(model.fees.source).toBe('fallback');
    expect(model.fees.makerRate).toBeGreaterThan(0);
    expect(model.fees.takerRate).toBeGreaterThan(0);
    expect(model.funding).toEqual(
      expect.objectContaining({ enabled: true, source: 'unavailable' }),
    );
    expect(model.slippage.source).toBe('fallback');
    expect(model.quality).toBe('fallback');
  });

  it('caches fee and funding lookups per connector and time range', async () => {
    const connector = {
      getTradingFeeRate: jest.fn(async () => ({
        symbol: 'BTCUSDT',
        makerRate: 0.0002,
        takerRate: 0.0005,
        source: 'exchange-account' as const,
        capturedAt: 1,
      })),
      getFundingRateHistory: jest.fn(async () => [
        { symbol: 'BTCUSDT', timestamp: 100, rate: 0.0001 },
      ]),
    } as any;
    const params = {
      connector,
      symbol: 'BTCUSDT',
      startTime: 1,
      endTime: 200,
      config: {},
    };

    await resolveExecutionCosts(params);
    await resolveExecutionCosts(params);

    expect(connector.getTradingFeeRate).toHaveBeenCalledTimes(1);
    expect(connector.getFundingRateHistory).toHaveBeenCalledTimes(1);
  });

  it('reports explicitly disabled funding separately from unavailable history', async () => {
    const connector = {
      getFundingRateHistory: jest.fn(),
    } as any;

    const { model } = await resolveExecutionCosts({
      connector,
      symbol: 'BTCUSDT',
      startTime: 1,
      endTime: 200,
      config: {},
      executionCosts: {
        fees: { makerRate: 0.001, takerRate: 0.001 },
        slippage: {
          baseBps: 10,
          spreadMultiplier: 1,
          marketImpactBps: 0,
          delayRiskMultiplier: 0,
        },
        funding: { enabled: false },
      },
    });

    expect(connector.getFundingRateHistory).not.toHaveBeenCalled();
    expect(model.funding).toEqual(
      expect.objectContaining({ enabled: false, source: 'disabled' }),
    );
  });
});
