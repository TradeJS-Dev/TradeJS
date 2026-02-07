import {
  calculateMaxDrawdown,
  calculateStatsFull,
  classifyMetric,
  getBacktestScore,
  getFormatted,
} from '@utils/stat';
import { PositionLogData } from '@types';

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

  it('getBacktestScore returns explicit score when present', () => {
    expect(getBacktestScore({ score: 77.7, orders: 1 })).toBe(77.7);
  });

  it('getBacktestScore returns 0 when orders are below minimal threshold', () => {
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
});
