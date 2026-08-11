import {
  buildDrawdownPoints,
  buildMonthlyStats,
  buildRollingPerformance,
  buildStrategyTradePoints,
  calculateMaxGrossStreak,
  calculateMaxLossStreak,
} from '../strategyPerformance';

describe('strategy performance', () => {
  const january = Date.UTC(2026, 0, 1, 1);
  const february = Date.UTC(2026, 1, 1, 9);
  const orderLog: Array<[number, number]> = [
    [january - 1, 100],
    [january, 110],
    [january + 1, 105],
    [february, 120],
  ];

  it('builds one normalized trade series for runtime and snapshot views', () => {
    const trades = buildStrategyTradePoints(orderLog);

    expect(trades.map(({ pnl, session }) => ({ pnl, session }))).toEqual([
      { pnl: 10, session: 'Asia' },
      { pnl: -5, session: 'Asia' },
      { pnl: 15, session: 'Europe' },
    ]);
    expect(buildRollingPerformance(trades, 2)).toEqual([
      { index: 1, winRate: 100, pnl: 10 },
      { index: 2, winRate: 50, pnl: 5 },
      { index: 3, winRate: 50, pnl: 10 },
    ]);
  });

  it('calculates drawdown and streaks from the same equity transitions', () => {
    expect(
      buildDrawdownPoints(orderLog).map((point) => point.drawdownPercent),
    ).toEqual([0, 0, (5 / 110) * 100, 0]);
    expect(calculateMaxGrossStreak(orderLog)).toBe(1);
    expect(calculateMaxLossStreak(orderLog)).toBe(1);
  });

  it('groups trade results by UTC month', () => {
    expect(buildMonthlyStats(orderLog)).toEqual([
      {
        year: 2026,
        months: [
          {
            id: '2026-01',
            year: 2026,
            monthIndex: 1,
            monthLabel: 'Jan',
            orders: 2,
            wins: 1,
            pnl: 5,
          },
          {
            id: '2026-02',
            year: 2026,
            monthIndex: 2,
            monthLabel: 'Feb',
            orders: 1,
            wins: 1,
            pnl: 15,
          },
        ],
      },
    ]);
  });
});
