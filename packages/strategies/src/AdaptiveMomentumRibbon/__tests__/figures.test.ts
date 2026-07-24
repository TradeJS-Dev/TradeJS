import { buildAdaptiveMomentumRibbonFigures } from '../figures';

describe('buildAdaptiveMomentumRibbonFigures', () => {
  it('shows price ribbon geometry and the momentum zero-cross evidence', () => {
    const figures = buildAdaptiveMomentumRibbonFigures({
      plotSeries: {
        kcMidline: [
          { time: 1_000, value: 99 },
          { time: 2_000, value: 100 },
        ],
      },
      linePlots: ['kcMidline'],
      direction: 'LONG',
      entryTimestamp: 2_000,
      entryPrice: 102,
      snapshot: {
        entryLong: true,
        entryShort: false,
        invalidated: false,
        activeBuy: true,
        activeSell: false,
        signalOsc: 0.72,
        kcMidline: 100,
        kcUpper: 104,
        kcLower: 96,
        invalidationLevel: 95,
        lineValues: {},
      },
    });

    expect(figures.lines?.[0]?.kind).toBe('amr_plot_line');
    expect(figures.annotations?.[0]?.items).toEqual(
      expect.arrayContaining([
        'Signal oscillator: 0.720',
        'Zero cross: above 0',
        'Active state: buy',
        'Invalidation: 95.00',
      ]),
    );
  });
});
