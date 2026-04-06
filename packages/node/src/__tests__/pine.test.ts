/** @jest-environment node */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPineScriptLoader,
  getLatestPineBooleanPlotValue,
  getLatestPineBooleanPlotValues,
  getLatestPineNumberPlotValue,
  getLatestPineNumberPlotValues,
  getLatestPineRawPlotValue,
  getPinePlotSeries,
  loadPineScriptFile,
  runPineScript,
  toFiniteNumber,
  toPineBoolean,
} from '@tradejs/node/pine';

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

    const latestFast = toFiniteNumber(
      getLatestPineRawPlotValue(context, 'fast'),
    );
    expect(typeof latestFast).toBe('number');
    expect(Number.isFinite(latestFast)).toBe(true);

    const longEvents = longSeries.filter((point) => point.value === 1);
    const shortEvents = shortSeries.filter((point) => point.value === 1);
    expect(longEvents.length).toBeGreaterThan(0);
    expect(shortEvents.length).toBeGreaterThan(0);
  });

  it('converts pine values to booleans', () => {
    expect(toPineBoolean(true)).toBe(true);
    expect(toPineBoolean(false)).toBe(false);
    expect(toPineBoolean(1)).toBe(true);
    expect(toPineBoolean(-2)).toBe(true);
    expect(toPineBoolean(0)).toBe(false);
    expect(toPineBoolean(NaN)).toBe(false);
    expect(toPineBoolean(null)).toBe(false);
    expect(toPineBoolean(undefined)).toBe(false);
    expect(toPineBoolean('1')).toBe(false);
  });

  it('returns finite numbers only', () => {
    expect(toFiniteNumber(10)).toBe(10);
    expect(toFiniteNumber(-0.5)).toBe(-0.5);
    expect(toFiniteNumber(Infinity)).toBeUndefined();
    expect(toFiniteNumber(NaN)).toBeUndefined();
    expect(toFiniteNumber('10')).toBeUndefined();
  });

  it('returns empty plot series for invalid plot names or malformed data', () => {
    expect(getPinePlotSeries({ plots: { fast: { data: [] } } }, '')).toEqual(
      [],
    );
    expect(
      getPinePlotSeries(
        { plots: { fast: { data: { not: 'array' } as any } } },
        'fast',
      ),
    ).toEqual([]);
    expect(getLatestPineRawPlotValue({}, 'fast')).toBeUndefined();
  });

  it('reads latest pine number and boolean plots via shared helpers', () => {
    const context = {
      plots: {
        fast: { data: [{ time: 1, value: 101.5 }] },
        slow: { data: [{ time: 1, value: 99.5 }] },
        entryLong: { data: [{ time: 1, value: 1 }] },
        entryShort: { data: [{ time: 1, value: 0 }] },
        invalid: { data: [{ time: 1, value: 'oops' }] },
      },
    };

    expect(getLatestPineNumberPlotValue(context, 'fast')).toBe(101.5);
    expect(getLatestPineNumberPlotValue(context, 'invalid')).toBeNull();
    expect(getLatestPineBooleanPlotValue(context, 'entryLong')).toBe(true);
    expect(getLatestPineBooleanPlotValue(context, 'entryShort')).toBe(false);

    expect(
      getLatestPineNumberPlotValues(context, ['fast', 'slow', 'invalid']),
    ).toEqual({
      fast: 101.5,
      slow: 99.5,
      invalid: null,
    });

    expect(
      getLatestPineBooleanPlotValues(context, ['entryLong', 'entryShort']),
    ).toEqual({
      entryLong: true,
      entryShort: false,
    });
  });

  it('loads pine scripts from files and handles fallbacks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-script-'));
    const filePath = path.join(tmpDir, 'sample.pine');
    fs.writeFileSync(filePath, '  plot(close)  \n', 'utf8');

    expect(loadPineScriptFile(filePath, 'fallback')).toBe('plot(close)');
    expect(loadPineScriptFile('', 'fallback')).toBe('fallback');
    expect(
      loadPineScriptFile(path.join(tmpDir, 'missing-file.pine'), 'fallback'),
    ).toBe('fallback');

    const fromBaseDir = createPineScriptLoader(tmpDir);
    expect(fromBaseDir('sample.pine', 'fallback')).toBe('plot(close)');
    expect(fromBaseDir(filePath, 'fallback')).toBe('plot(close)');
    expect(fromBaseDir('', 'fallback')).toBe('fallback');
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

  it('accepts unix-second candles and limit below 1 by normalizing runtime args', async () => {
    const unixSecondsCandles = makeCandles(20, 1_700_000_000).map((candle) => ({
      ...candle,
      timestamp: Math.floor(candle.timestamp / 1000),
    }));

    const context = await runPineScript({
      candles: unixSecondsCandles as any,
      script: SCRIPT,
      symbol: 'TESTUSDT',
      timeframe: '1',
      limit: 0,
      inputs: { source: 'close' },
    });

    expect(getPinePlotSeries(context, 'fast').length).toBeGreaterThan(0);
  });
});
