import {
  buildTimeSeriesTicks,
  formatTimeSeriesAxisTimestamp,
  formatTimeSeriesTooltipTimestamp,
} from '../timeSeriesChart';

describe('timeSeriesChart helpers', () => {
  it('keeps the exact selected period boundaries as the first and last ticks', () => {
    expect(buildTimeSeriesTicks(100, 1_100, 6)).toEqual([
      100, 300, 500, 700, 900, 1_100,
    ]);
  });

  it('normalizes reversed boundaries without losing either endpoint', () => {
    expect(buildTimeSeriesTicks(1_100, 100, 3)).toEqual([100, 600, 1_100]);
  });

  it('includes time for short windows and only the date for wider windows', () => {
    const timestamp = new Date(2026, 7, 2, 10, 30).getTime();

    expect(
      formatTimeSeriesAxisTimestamp({
        timestamp,
        startTimestamp: timestamp,
        endTimestamp: timestamp + 24 * 60 * 60 * 1000,
      }),
    ).toBe('02.08 10:30');
    expect(
      formatTimeSeriesAxisTimestamp({
        timestamp,
        startTimestamp: timestamp,
        endTimestamp: timestamp + 7 * 24 * 60 * 60 * 1000,
      }),
    ).toBe('02.08');
  });

  it('reads the timestamp from tooltip payload when the label is a series key', () => {
    const timestamp = new Date(2026, 7, 2, 10, 30).getTime();

    expect(
      formatTimeSeriesTooltipTimestamp('equity', [
        { payload: { timestamp, equity: 95 } },
      ]),
    ).toBe('02.08.2026 10:30');
  });

  it('does not throw when a chart passes an invalid date label', () => {
    expect(formatTimeSeriesTooltipTimestamp('equity')).toBe('equity');
    expect(formatTimeSeriesTooltipTimestamp(1e20)).toBe(String(1e20));
    expect(
      formatTimeSeriesAxisTimestamp({
        timestamp: 1e20,
        startTimestamp: 0,
        endTimestamp: 1e20,
      }),
    ).toBe(String(1e20));
  });
});
