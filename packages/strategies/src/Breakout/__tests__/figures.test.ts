import { buildBreakoutFigures } from '../figures';

describe('buildBreakoutFigures', () => {
  it('explains the breakout level, volatility band, score, and active rules', () => {
    const figures = buildBreakoutFigures({
      direction: 'LONG',
      entryTimestamp: 2_000,
      entryPrice: 105,
      stopLossPrice: 98,
      takeProfitPrice: 116,
      referenceTimestamp: 1_000,
      breakoutLevel: 102,
      volatilityBand: 103,
      signals: {
        CLOSE_ABOVE_HIGH_LEVEL: true,
        SMA_UPTREND: true,
        OBV_ABOVE_SMA: false,
      },
      signalRules: {
        CLOSE_ABOVE_HIGH_LEVEL: { weight: 2, required: true },
        SMA_UPTREND: { weight: 1 },
        OBV_ABOVE_SMA: { weight: 1 },
      },
      requiredScore: 3,
    });

    expect(figures.lines?.map((line) => line.kind)).toEqual(
      expect.arrayContaining([
        'breakout_breakout_level',
        'breakout_volatility_band',
      ]),
    );
    expect(figures.annotations?.[0]).toEqual(
      expect.objectContaining({
        title: 'Breakout LONG',
        items: expect.arrayContaining([
          'Score: 3.00 / 3.00',
          'Required: close above high level',
          'Active: sma uptrend',
        ]),
      }),
    );
  });
});
