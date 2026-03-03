/** @jest-environment node */

import {
  asFiniteNumber,
  asPineBoolean,
  getLatestPinePlotValue,
  getPinePlotSeries,
  runPineScript,
} from '@utils/pine';

const makeCandles = (count = 120, startTimestamp = 1_700_000_000_000) =>
  Array.from({ length: count }, (_, index) => {
    const close = 100 + Math.sin(index / 4) * 5;
    return {
      timestamp: startTimestamp + index * 60_000,
      dt: new Date(startTimestamp + index * 60_000).toISOString(),
      open: close - 0.2,
      close,
      high: close + 0.8,
      low: close - 0.8,
      volume: 1_000 + index,
      turnover: close * (1_000 + index),
    };
  });

const SCRIPT = `//@version=5
indicator("Unit Pine")
fast = ta.sma(close, 5)
slow = ta.sma(close, 15)
entryLong = fast > slow and fast[1] <= slow[1]
entryShort = fast < slow and fast[1] >= slow[1]
plot(fast, "fast")
plot(slow, "slow")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
`;

describe('pine utils', () => {
  it('runs pine script on candle data and returns plot series', async () => {
    const context = await runPineScript({
      candles: makeCandles(),
      script: SCRIPT,
      symbol: 'TESTUSDT',
      timeframe: '15',
    });

    const fast = getPinePlotSeries(context, 'fast');
    const slow = getPinePlotSeries(context, 'slow');
    const longSeries = getPinePlotSeries(context, 'entryLong');
    const shortSeries = getPinePlotSeries(context, 'entryShort');

    expect(fast.length).toBeGreaterThan(0);
    expect(slow.length).toBeGreaterThan(0);
    expect(longSeries.length).toBeGreaterThan(0);
    expect(shortSeries.length).toBeGreaterThan(0);

    const latestFast = asFiniteNumber(getLatestPinePlotValue(context, 'fast'));
    expect(typeof latestFast).toBe('number');
    expect(Number.isFinite(latestFast)).toBe(true);

    const longEvents = longSeries.filter((point) => point.value === 1);
    const shortEvents = shortSeries.filter((point) => point.value === 1);
    expect(longEvents.length).toBeGreaterThan(0);
    expect(shortEvents.length).toBeGreaterThan(0);
  });

  it('converts pine values to booleans', () => {
    expect(asPineBoolean(true)).toBe(true);
    expect(asPineBoolean(false)).toBe(false);
    expect(asPineBoolean(1)).toBe(true);
    expect(asPineBoolean(-2)).toBe(true);
    expect(asPineBoolean(0)).toBe(false);
    expect(asPineBoolean(null)).toBe(false);
    expect(asPineBoolean(undefined)).toBe(false);
    expect(asPineBoolean('1')).toBe(false);
  });

  it('throws clear errors for empty inputs', async () => {
    await expect(
      runPineScript({
        candles: [],
        script: SCRIPT,
      }),
    ).rejects.toThrow('No candles provided');

    await expect(
      runPineScript({
        candles: makeCandles(10),
        script: '',
      }),
    ).rejects.toThrow('Pine script is empty');
  });
});
