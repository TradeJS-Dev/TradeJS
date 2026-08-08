import { buildMarketFlushReversalFigures } from '../figures';

describe('buildMarketFlushReversalFigures', () => {
  it('shows the swept level and liquidation/participation evidence', () => {
    const figures = buildMarketFlushReversalFigures({
      direction: 'LONG',
      entryTimestamp: 2_000,
      entryPrice: 100,
      stopLossPrice: 94,
      takeProfitPrice: 113,
      referenceTimestamp: 1_000,
      referencePrice: 95,
      context: {
        signalDirection: 'LONG',
        marketPressure: 'long_flush',
        marketRiskFlags: ['long_liquidation_spike'],
        marketLiqSpikeRatio: 2.4,
        marketLiqImbalance: -0.65,
        marketFundingZScore: 1.3,
        marketPriceOiDivergenceType: 'bullish',
        marketFlushConfirmed: true,
        minMarketLiqSpikeRatio: 1.5,
        rejectionClosePosition: 0.8,
        rejectionConfirmed: true,
        sweepState: 'sweep_low',
        breakoutState: 'inside_range',
        tailSide: 'low',
        rangePosition20: 0.08,
        sweepWickPct: 0.42,
        volumeRel20: 1.4,
        buyPressurePct: 0.61,
        deltaDivergenceVsPrice: 'bullish',
        structureConfirmed: true,
        participationConfirmed: true,
      },
    });

    expect(figures.points?.map((points) => points.kind)).toContain(
      'mfr_flush_reference',
    );
    expect(figures.annotations?.[0]?.items).toEqual(
      expect.arrayContaining([
        'Pressure: long_flush; liq spike: 2.40',
        'Tail: low; wick: 42%',
        'Volume rel20: 1.40; buy pressure: 61%',
      ]),
    );
  });
});
