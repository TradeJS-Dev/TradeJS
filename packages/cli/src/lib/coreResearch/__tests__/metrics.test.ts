import {
  buildCostStress,
  buildEqualTimeFolds,
  buildMonthlyWindows,
  buildRegimeMetrics,
  buildTerminalWindows,
  DAY_MS,
  summarizeCoreResearchCohorts,
  summarizeCoreResearchTrades,
  summarizeCoreResearchWindow,
} from '../metrics';
import { END, makeTrade, START } from '../__fixtures__/fixtures';

describe('core research metrics', () => {
  it('computes independently worked payoff, tail, holding, streak, and realized-DD metrics', () => {
    const metrics = summarizeCoreResearchTrades(
      [
        makeTrade({
          signalId: '1',
          exitTimestamp: START + 1,
          entryTimestamp: START - 3_600_000 + 1,
          netProfit: 10,
        }),
        makeTrade({
          signalId: '2',
          exitTimestamp: START + 2,
          entryTimestamp: START - 7_200_000 + 2,
          netProfit: -4,
        }),
        makeTrade({
          signalId: '3',
          exitTimestamp: START + 3,
          entryTimestamp: START - 10_800_000 + 3,
          netProfit: -6,
        }),
        makeTrade({
          signalId: '4',
          exitTimestamp: START + 4,
          entryTimestamp: START - 14_400_000 + 4,
          netProfit: 20,
        }),
        makeTrade({
          signalId: '5',
          exitTimestamp: START + 5,
          entryTimestamp: START - 18_000_000 + 5,
          netProfit: 0,
        }),
      ],
      5,
    );

    expect(metrics).toMatchObject({
      trades: 5,
      wins: 2,
      losses: 3,
      breakeven: 1,
      pnl: 20,
      pnlPerTrade: 4,
      grossProfit: 30,
      grossLoss: 10,
      profitFactor: 3,
      profitFactorStatus: 'finite',
      winRatePct: 40,
      realizedMaxDrawdown: 10,
      cadencePerDay: 1,
      averageWin: 15,
      averageLoss: 5,
      payoffRatio: 3,
      medianPnl: 0,
      medianHoldingHours: 3,
      maximumConsecutiveLosses: 2,
    });
    expect(metrics.pnlP05).toBeCloseTo(-5.6);
    expect(metrics.pnlP95).toBeCloseTo(18);
  });

  it('keeps ALL, LONG, and SHORT cohort economics separate', () => {
    const cohorts = summarizeCoreResearchCohorts(
      [
        makeTrade({ direction: 'LONG', netProfit: 10 }),
        makeTrade({ direction: 'LONG', netProfit: 2, signalId: 'long-2' }),
        makeTrade({ direction: 'SHORT', netProfit: -4, signalId: 'short' }),
      ],
      2,
    );

    expect(cohorts.ALL).toMatchObject({ trades: 3, pnl: 8 });
    expect(cohorts.ALL.pnlPerTrade).toBeCloseTo(8 / 3);
    expect(cohorts.LONG).toMatchObject({ trades: 2, pnl: 12, pnlPerTrade: 6 });
    expect(cohorts.SHORT).toMatchObject({
      trades: 1,
      pnl: -4,
      pnlPerTrade: -4,
    });
    expect(cohorts.ALL.pnlPerTrade).not.toBe(
      ((cohorts.LONG.pnlPerTrade ?? 0) + (cohorts.SHORT.pnlPerTrade ?? 0)) / 2,
    );
  });

  it('uses half-open immutable windows and keeps zero-activity terminal slices', () => {
    const trades = [
      makeTrade({ signalId: 'before', exitTimestamp: START - 1 }),
      makeTrade({ signalId: 'start', exitTimestamp: START, netProfit: 3 }),
      makeTrade({ signalId: 'inside', exitTimestamp: END - 1, netProfit: 4 }),
      makeTrade({ signalId: 'end', exitTimestamp: END, netProfit: 100 }),
    ];
    expect(
      summarizeCoreResearchWindow({
        trades,
        label: 'full',
        start: START,
        end: END,
      }).cohorts.ALL,
    ).toMatchObject({ trades: 2, pnl: 7 });

    const terminal = buildTerminalWindows({
      trades: [],
      end: END,
      terminalDays: [5],
    });
    expect(terminal[0]).toMatchObject({ label: '5d', periodDays: 5 });
    expect(terminal[0].cohorts.ALL).toMatchObject({ trades: 0, pnl: 0 });
  });

  it('partitions equal-time folds and calendar months without overlap', () => {
    const trades = [
      makeTrade({ signalId: 'left', exitTimestamp: START }),
      makeTrade({ signalId: 'boundary', exitTimestamp: START + 5 * DAY_MS }),
      makeTrade({ signalId: 'right', exitTimestamp: END - 1 }),
    ];
    const folds = buildEqualTimeFolds({
      trades,
      start: START,
      end: END,
      folds: 2,
    });
    expect(folds.map((fold) => fold.cohorts.ALL.trades)).toEqual([1, 2]);

    const monthStart = Date.UTC(2026, 0, 15);
    const monthEnd = Date.UTC(2026, 2, 2);
    const months = buildMonthlyWindows({
      trades: [],
      start: monthStart,
      end: monthEnd,
    });
    expect(
      months.map((month) => [month.label, month.start, month.end]),
    ).toEqual([
      ['2026-01', monthStart, Date.UTC(2026, 1, 1)],
      ['2026-02', Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)],
      ['2026-03', Date.UTC(2026, 2, 1), monthEnd],
    ]);
  });

  it('groups causal regimes and applies extra round-trip cost without mutating source trades', () => {
    const bull = makeTrade({
      signalId: 'bull',
      netProfit: 10,
      entryPrice: 100,
      qty: 2,
    });
    const bear = makeTrade({
      signalId: 'bear',
      netProfit: -2,
      regime: {
        trend: 'bear',
        volatility: 'expanded',
        breadth: 'risk_off',
        derivatives: 'crowded',
        key: 'bear|expanded|risk_off|crowded',
      },
    });
    const regimes = buildRegimeMetrics([bull, bear], 10);
    expect(regimes['bull|normal|risk_on|neutral'].ALL.pnl).toBe(10);
    expect(regimes['bear|expanded|risk_off|crowded'].ALL.pnl).toBe(-2);

    const stressed = buildCostStress({
      trades: [bull],
      periodDays: 1,
      extraRoundTripBps: [25],
    });
    expect(stressed[0].cohorts.ALL.pnl).toBe(9.5);
    expect(bull.netProfit).toBe(10);
  });

  it('distinguishes undefined and infinite profit factor', () => {
    expect(summarizeCoreResearchTrades([], 1)).toMatchObject({
      profitFactor: null,
      profitFactorStatus: 'undefined',
      pnlPerTrade: null,
      winRatePct: null,
    });
    expect(
      summarizeCoreResearchTrades([makeTrade({ netProfit: 1 })], 1),
    ).toMatchObject({
      profitFactor: null,
      profitFactorStatus: 'infinite_no_gross_loss',
    });
  });
});
