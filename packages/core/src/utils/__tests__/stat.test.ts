import {
  calculateAdvancedTradeMetrics,
  calculateMaxDrawdown,
  calculateStatsFull,
  classifyMetric,
  getBacktestScore,
  getFormatted,
} from '../stat';
import { PositionLogData } from '@tradejs/types';

describe('stat utils', () => {
  it('calculateMaxDrawdown returns drawdown percent from peak', () => {
    expect(calculateMaxDrawdown([100, 120, 90, 110])).toBe(25);
  });

  it('calculateStatsFull returns null for empty position log', () => {
    expect(calculateStatsFull([])).toBeNull();
  });

  it('calculateStatsFull computes wins, losses and streaks', () => {
    const data: PositionLogData = [
      {
        direction: 'LONG',
        open: { amount: 100, timestamp: 1_000 },
        close: { amount: 110, timestamp: 2_000 },
      },
      {
        direction: 'LONG',
        open: { amount: 110, timestamp: 3_000 },
        close: { amount: 120, timestamp: 4_000 },
      },
      {
        direction: 'LONG',
        open: { amount: 120, timestamp: 5_000 },
        close: { amount: 100, timestamp: 6_000 },
      },
      {
        direction: 'LONG',
        open: { amount: 100, timestamp: 7_000 },
        close: { amount: 90, timestamp: 8_000 },
      },
    ];

    const stat = calculateStatsFull(data)!;

    expect(stat.wins).toBe(2);
    expect(stat.losses).toBe(2);
    expect(stat.maxConsecutiveWins).toBe(2);
    expect(stat.maxConsecutiveLosses).toBe(2);
    expect(stat.maxDrawdown).toBeGreaterThan(0);
  });

  it('classifyMetric works for both higher and lower directions', () => {
    expect(classifyMetric('winRate', 65)).toBe('success');
    expect(classifyMetric('maxDrawdown', 10)).toBe('success');
    expect(classifyMetric('maxDrawdown', 20)).toBe('warning');
  });

  it('classifies P&L by sign', () => {
    expect(classifyMetric('netProfit', 1)).toBe('success');
    expect(classifyMetric('netProfit', 0)).toBe('neutral');
    expect(classifyMetric('netProfit', -1)).toBe('error');
  });

  it('getBacktestScore returns rounded netProfit * winRate', () => {
    expect(getBacktestScore({ netProfit: 173.88, winRate: 87.5 })).toBe(15215);
  });

  it('getBacktestScore returns 0 when required values are missing', () => {
    expect(getBacktestScore({ orders: 1, cagr: 100, maxDrawdown: 1 })).toBe(0);
  });

  it('getFormatted returns formatted value and level from thresholds', () => {
    const formatted = getFormatted({ winRate: 55.55 }, 'winRate');

    expect(formatted.formatted).toBe('55.5%');
    expect(formatted.level).toBe('warning');
  });

  it('getFormatted returns safe fallback when stat is missing', () => {
    expect(getFormatted(undefined, 'winRate')).toEqual({
      formatted: '0',
      level: 'error',
    });
  });

  describe('calculateAdvancedTradeMetrics', () => {
    const day = 24 * 60 * 60 * 1000;
    const start = Date.UTC(2026, 0, 1);
    const trades = [
      {
        id: '1',
        timestamp: start,
        pnl: 10,
        symbol: 'AAAUSDT',
        direction: 'LONG',
        slippageCost: 1,
        grossPnl: 11,
        approved: true,
      },
      {
        id: '2',
        timestamp: start + day,
        pnl: -5,
        symbol: 'BBBUSDT',
        direction: 'LONG',
        slippageCost: 0,
        grossPnl: -5,
        approved: true,
      },
      {
        id: '3',
        timestamp: start + 2 * day,
        pnl: 20,
        symbol: 'AAAUSDT',
        direction: 'SHORT',
        slippageCost: 2,
        grossPnl: 22,
        approved: true,
      },
      {
        id: '4',
        timestamp: Date.UTC(2026, 1, 1),
        pnl: -10,
        symbol: 'CCCUSDT',
        direction: 'SHORT',
        slippageCost: 0,
        grossPnl: -10,
        approved: true,
      },
      {
        id: '5',
        timestamp: Date.UTC(2026, 2, 1),
        pnl: 5,
        symbol: 'AAAUSDT',
        direction: 'LONG',
        slippageCost: 1,
        grossPnl: 6,
        approved: false,
        blocked: true,
      },
    ];
    const orderLog: Array<[number, number]> = [
      [start, 100],
      [start + day, 110],
      [start + 2 * day, 105],
      [start + 3 * day, 125],
      [Date.UTC(2026, 1, 1), 115],
      [Date.UTC(2026, 2, 1), 120],
    ];

    it('computes core profitability and cadence metrics', () => {
      const metrics = calculateAdvancedTradeMetrics({
        trades,
        orderLog,
        startTimestamp: start,
        endTimestamp: Date.UTC(2026, 2, 1),
      });

      expect(metrics.core.trades).toBe(5);
      expect(metrics.core.wins).toBe(3);
      expect(metrics.core.losses).toBe(2);
      expect(metrics.core.winRate).toBeCloseTo(60);
      expect(metrics.core.totalPnl).toBe(20);
      expect(metrics.core.avgTrade).toBe(4);
      expect(metrics.core.grossProfit).toBe(35);
      expect(metrics.core.grossLoss).toBe(15);
      expect(metrics.core.profitFactor).toBeCloseTo(35 / 15);
      expect(metrics.core.payoffRatio).toBeCloseTo(35 / 3 / (15 / 2));
      expect(metrics.core.expectancy).toBe(4);
      expect(metrics.core.tradesPerDay).toBeCloseTo(5 / 59);
      expect(metrics.core.tradesPerWeek).toBeCloseTo((5 / 59) * 7);
    });

    it('computes risk and stability metrics from trades and order log', () => {
      const metrics = calculateAdvancedTradeMetrics({
        trades,
        orderLog,
        startTimestamp: start,
        endTimestamp: Date.UTC(2026, 2, 1),
      });

      expect(metrics.risk.maxDrawdown).toBe(10);
      expect(metrics.risk.maxDrawdownPercent).toBeCloseTo(8);
      expect(metrics.risk.maxDrawdownToTotalProfit).toBeCloseTo(0.5);
      expect(metrics.risk.maxDrawdownToGrossProfit).toBeCloseTo(10 / 35);
      expect(metrics.risk.recoveryFactor).toBe(2);
      expect(metrics.risk.maxLossStreak).toBe(1);
      expect(metrics.risk.losingMonthsCount).toBe(1);
      expect(metrics.risk.worstMonthPnl).toBe(-10);
      expect(metrics.risk.worstRolling30dPnl).toBe(-5);
      expect(metrics.risk.worstRolling90dPnl).toBe(0);
      expect(metrics.stability.monthlyWinRate).toBeCloseTo(
        ((2 / 3) * 100) / 3 + 100 / 3,
      );
      expect(metrics.stability.positiveMonthsPercent).toBeCloseTo(
        (2 / 3) * 100,
      );
      expect(metrics.stability.quarterlyPnl).toEqual([
        { quarter: '2026 Q1', pnl: 20 },
      ]);
      expect(metrics.stability.rolling365Pnl).toBe(20);
      expect(metrics.stability.medianMonthlyPnl).toBe(5);
      expect(metrics.stability.iqrMonthlyPnl).toBe(17.5);
      expect(metrics.stability.top5ProfitShare).toBe(100);
      expect(metrics.stability.top10ProfitShare).toBe(100);
    });

    it('computes distribution, risk-adjusted and operational metrics', () => {
      const metrics = calculateAdvancedTradeMetrics({
        trades,
        orderLog,
        startTimestamp: start,
        endTimestamp: Date.UTC(2026, 2, 1),
      });

      expect(metrics.distribution.medianTrade).toBe(5);
      expect(metrics.distribution.p10Trade).toBe(-8);
      expect(metrics.distribution.p25Trade).toBe(-5);
      expect(metrics.distribution.p75Trade).toBe(10);
      expect(metrics.distribution.p90Trade).toBe(16);
      expect(metrics.distribution.largestWin).toBe(20);
      expect(metrics.distribution.largestLoss).toBe(-10);
      expect(metrics.distribution.tailRatio).toBeCloseTo(2);
      expect(metrics.distribution.skewness).not.toBeNull();
      expect(metrics.riskAdjusted.sharpeDaily).not.toBeNull();
      expect(metrics.riskAdjusted.sortinoDaily).not.toBeNull();
      expect(metrics.riskAdjusted.calmar).toBe(metrics.riskAdjusted.mar);
      expect(metrics.operational.avgSlippageCost).toBe(0.8);
      expect(metrics.operational.pnlBeforeSlippage).toBe(24);
      expect(metrics.operational.pnlAfterSlippage).toBe(20);
      expect(metrics.operational.approvalRate).toBe(80);
      expect(metrics.operational.blockedProfitableTrades).toBe(1);
      expect(metrics.operational.approvedLosingTrades).toBe(2);
      expect(metrics.operational.symbolConcentrationTop1).toBe(70);
      expect(metrics.operational.symbolConcentrationTop5).toBe(100);
      expect(metrics.operational.sessionConcentrationTop1).toBe(100);
      expect(metrics.operational.longTrades).toBe(3);
      expect(metrics.operational.shortTrades).toBe(2);
      expect(metrics.operational.longPnl).toBe(10);
      expect(metrics.operational.shortPnl).toBe(10);
    });
  });
});
