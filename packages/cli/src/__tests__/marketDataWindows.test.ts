import {
  getClosedCandlesForInterval,
  splitCandlesForReplayWindow,
} from '../lib/marketData/windows';

describe('market data window helpers', () => {
  it('keeps only candles before the current open timestamp', () => {
    const candles = [
      { timestamp: 0 },
      { timestamp: 15 * 60_000 },
      { timestamp: 30 * 60_000 },
    ];

    expect(
      getClosedCandlesForInterval(candles, 30 * 60_000 + 1, 15 * 60_000),
    ).toEqual([{ timestamp: 0 }, { timestamp: 15 * 60_000 }]);
  });

  it('splits preload and replay candles without including pre-preload data', () => {
    const preloadStart = 1_000;
    const start = 3_000;
    const candles = [
      { timestamp: 500, open: 1 },
      { timestamp: 1_000, open: 2 },
      { timestamp: 2_000, open: 3 },
      { timestamp: 3_000, open: 4 },
    ] as any;

    expect(splitCandlesForReplayWindow(candles, start, preloadStart)).toEqual({
      prevData: [
        { timestamp: 1_000, open: 2 },
        { timestamp: 2_000, open: 3 },
      ],
      replayData: [{ timestamp: 3_000, open: 4 }],
    });
  });
});
