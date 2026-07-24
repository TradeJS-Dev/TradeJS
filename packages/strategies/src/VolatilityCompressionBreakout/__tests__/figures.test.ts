import { buildVolatilityCompressionBreakoutFigures } from '../figures';

describe('buildVolatilityCompressionBreakoutFigures', () => {
  it('shows the breakout level and compression-to-expansion evidence', () => {
    const figures = buildVolatilityCompressionBreakoutFigures({
      direction: 'SHORT',
      entryTimestamp: 2_000,
      entryPrice: 95,
      stopLossPrice: 101,
      takeProfitPrice: 82,
      breakoutLevel: 96,
      context: {
        signalDirection: 'SHORT',
        breakoutState: 'below_low_level',
        atrPctRank100: 18,
        bbWidthRank100: 22,
        rangeExpansionRank20: 81,
        breakoutBodyAtr: 0.7,
        volumeRel20: 1.5,
        buyPressurePct: 0.38,
        tradeFlowBuyPressurePct: 0.35,
        mtfAlignment: 'aligned_bear',
        compressionConfirmed: true,
        expansionConfirmed: true,
        participationConfirmed: true,
        mtfConfirmed: true,
        tradeFlowConfirmed: true,
      },
    });

    expect(figures.points?.map((points) => points.kind)).toContain(
      'vcb_breakout_level',
    );
    expect(figures.annotations?.[0]?.items).toEqual(
      expect.arrayContaining([
        'Breakout: below_low_level',
        'Compression ranks — ATR: 18, BB width: 22',
        'Expansion rank: 81; body: 0.70 ATR',
        'MTF: aligned_bear',
      ]),
    );
  });
});
