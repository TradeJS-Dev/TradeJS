import { buildRelativeRotationFigures } from '../figures';

describe('buildRelativeRotationFigures', () => {
  it('explains the relative-strength evidence behind the entry', () => {
    const figures = buildRelativeRotationFigures({
      direction: 'LONG',
      entryTimestamp: 2_000,
      entryPrice: 105,
      stopLossPrice: 98,
      takeProfitPrice: 119,
      context: {
        signalDirection: 'LONG',
        targetVsBtcRatioTrend: 'up',
        targetVsBtcAlpha24h: 1.2,
        targetVsBtcRatioReturn24h: 0.8,
        targetVsBtcBeta20: 1.1,
        targetVsBtcCorrelation20: 0.7,
        targetVsEthRatioTrend: 'up',
        targetVsEthAlpha24h: 0.9,
        targetVsEthRatioReturn24h: 0.6,
        relativeStrength1h: 0.25,
        btcAltRegime: 'alt_lead',
        marketBreadthReturn: 0.4,
        volumeRel20: 1.3,
        rotationScore: 2.65,
        ratioTrendConfirmed: true,
        alphaConfirmed: true,
        ratioReturnConfirmed: true,
        relativeStrengthConfirmed: true,
        regimeConfirmed: true,
      },
    });

    expect(figures.annotations?.[0]?.items).toEqual(
      expect.arrayContaining([
        'BTC ratio: up',
        'Alpha 24h: 1.20%',
        'Relative strength 1h: 0.25%',
        'Rotation score: 2.65',
      ]),
    );
  });
});
